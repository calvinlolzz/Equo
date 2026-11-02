import json
import os
import sys
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, Request, build_opener


BASE_URL = os.environ.get("EQUO_BASE_URL", "").rstrip("/")
GOOGLE_ID_TOKEN = os.environ.get("EQUO_GOOGLE_ID_TOKEN", "").strip()


def fail(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def request_json(opener, method: str, path: str, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(
        urljoin(f"{BASE_URL}/", path.lstrip("/")),
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )

    try:
        with opener.open(request, timeout=20) as response:
            payload = response.read().decode("utf-8")
            headers = dict(response.headers)
            content_type = headers.get("Content-Type", "")
            if payload and "application/json" not in content_type:
                return response.status, headers, {
                    "non_json": payload[:300],
                    "content_type": content_type,
                    "final_url": response.geturl(),
                }
            return response.status, headers, json.loads(payload) if payload else None
    except HTTPError as error:
        payload = error.read().decode("utf-8")
        headers = dict(error.headers)
        content_type = headers.get("Content-Type", "")
        if payload and "application/json" not in content_type:
            return error.code, headers, {
                "non_json": payload[:300],
                "content_type": content_type,
                "final_url": error.geturl(),
            }
        return error.code, headers, json.loads(payload) if payload else None


def error_code(payload) -> str | None:
    if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
        code = payload["error"].get("code")
        return code if isinstance(code, str) else None
    return None


def has_set_cookie(headers: dict) -> bool:
    return any(name.lower() == "set-cookie" for name in headers)


def evaluate_liff(config, exchange, bogus_session) -> str | None:
    """Judge the LINE-in-app (LIFF) endpoints. Each argument is (status, headers, payload).

    Returns a failure message, or None when everything is as it should be. Pure
    on purpose: scripts/test-smoke-production-api.py drives it with canned
    responses, because the interesting cases (LIFF off, LIFF on, a gate that
    went missing) cannot all be produced against one live deployment.

    What it pins:
      * GET /line/liff answers 200 {liff_id: string|null}, uncached.
      * POST /auth/line with a junk-but-well-formed token is refused: 503
        LINE_UNAVAILABLE while LIFF is unconfigured, 401 LINE_ID_TOKEN_INVALID
        once it is. Never 200, never a Set-Cookie, never a token in the body.
      * A LIFF-shaped bearer that was not signed by us is 401 on a read: the
        gate that keeps LINE sessions inside their scope is deployed.
    """
    config_status, config_headers, config_payload = config

    if config_status != 200:
        return f"/api/v1/line/liff expected 200, got {config_status}: {config_payload}"

    if not isinstance(config_payload, dict) or "liff_id" not in config_payload:
        return f"/api/v1/line/liff expected a liff_id field, got: {config_payload}"

    liff_id = config_payload["liff_id"]

    if liff_id is not None and not isinstance(liff_id, str):
        return f"/api/v1/line/liff liff_id must be a string or null, got: {liff_id!r}"

    if config_headers.get("Cache-Control", config_headers.get("cache-control", "")) != "no-store":
        return "/api/v1/line/liff must be served with Cache-Control: no-store"

    exchange_status, exchange_headers, exchange_payload = exchange

    if has_set_cookie(exchange_headers):
        return "/api/v1/auth/line must never set a cookie"

    if "equoL1" in json.dumps(exchange_payload):
        return "/api/v1/auth/line answered a junk ID token with a session token"

    if liff_id is None:
        expected_status, expected_code = 503, "LINE_UNAVAILABLE"
    else:
        expected_status, expected_code = 401, "LINE_ID_TOKEN_INVALID"

    if exchange_status != expected_status or error_code(exchange_payload) != expected_code:
        return (
            f"/api/v1/auth/line with a junk token expected {expected_status} {expected_code} "
            f"(liff_id {'unset' if liff_id is None else 'configured'}), got {exchange_status}: {exchange_payload}"
        )

    session_status, _, session_payload = bogus_session

    if session_status != 401:
        return f"a forged LIFF bearer on GET /api/v1/groups expected 401, got {session_status}: {session_payload}"

    return None


def request_json_with(opener, method: str, path: str, body: dict | None = None, headers: dict | None = None):
    """request_json with extra request headers (the forged-bearer probe needs Authorization)."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(
        urljoin(f"{BASE_URL}/", path.lstrip("/")),
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )

    try:
        with opener.open(request, timeout=20) as response:
            payload = response.read().decode("utf-8")
            return response.status, dict(response.headers), json.loads(payload) if payload else None
    except HTTPError as error:
        payload = error.read().decode("utf-8")
        try:
            parsed = json.loads(payload) if payload else None
        except ValueError:
            parsed = {"non_json": payload[:300]}
        return error.code, dict(error.headers), parsed


def main() -> int:
    if not BASE_URL:
        return fail("set EQUO_BASE_URL to the deployed site, for example https://example.vercel.app")

    opener = build_opener(HTTPCookieProcessor(CookieJar()))

    try:
        status, _, payload = request_json(opener, "GET", "/api/v1/unknown")
    except (URLError, TimeoutError) as error:
        return fail(f"API smoke request failed: {error}")

    if isinstance(payload, dict) and "non_json" in payload:
        final_url = payload.get("final_url", "")
        body = payload.get("non_json", "")
        if "vercel.com/sso-api" in final_url or "vercel.com" in final_url or "data-dpl-id" in body:
            return fail("deployment is protected by Vercel SSO; use `vercel curl --deployment <url>` or disable protection for smoke testing")
        return fail(
            f"API returned non-JSON response: status={status}, content_type={payload.get('content_type')}, "
            f"final_url={final_url}, body={body}"
        )

    if status == 503 and isinstance(payload, dict):
        error = payload.get("error", {})
        if error.get("code") == "RUNTIME_ENV_MISSING":
            return fail(error.get("message", "runtime env is missing"))

    if status != 404:
        return fail(f"/api/v1/unknown expected 404 when runtime env is configured, got {status}: {payload}")

    if GOOGLE_ID_TOKEN:
        status, headers, payload = request_json(opener, "POST", "/api/v1/auth/google", {"id_token": GOOGLE_ID_TOKEN})
        set_cookie = headers.get("Set-Cookie", "")

        if status != 200:
            return fail(f"/api/v1/auth/google expected 200 with EQUO_GOOGLE_ID_TOKEN, got {status}: {payload}")

        if "equo_session=" not in set_cookie:
            return fail("/api/v1/auth/google did not return equo_session cookie")

    else:
        print("SKIP: EQUO_GOOGLE_ID_TOKEN not set; skipped Google session exchange smoke step")

    # No login needed: the LINE-in-app endpoints are probed with junk on purpose.
    # Nothing here can sign in, so this runs on every smoke.
    try:
        config = request_json_with(opener, "GET", "/api/v1/line/liff")
        exchange = request_json_with(opener, "POST", "/api/v1/auth/line", {"id_token": "x.y.z"})
        bogus_session = request_json_with(
            opener, "GET", "/api/v1/groups", headers={"Authorization": "Bearer equoL1.e30.AAAA"}
        )
    except (URLError, TimeoutError) as error:
        return fail(f"LIFF smoke request failed: {error}")

    liff_problem = evaluate_liff(config, exchange, bogus_session)

    if liff_problem:
        return fail(liff_problem)

    print("PASS: production API smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
