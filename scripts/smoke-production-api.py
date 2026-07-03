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

    print("PASS: production API smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
