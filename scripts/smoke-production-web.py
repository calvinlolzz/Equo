from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


BASE_URL = os.environ.get("EQUO_BASE_URL", "").rstrip("/")


@dataclass(frozen=True)
class Check:
    label: str
    path: str
    status: int
    content_type_contains: str
    body_contains: str | None = None


CHECKS = (
    Check("home", "/", 200, "text/html", '<div id="root"></div>'),
    Check("group deep link", "/group/smoke-test", 200, "text/html", '<div id="root"></div>'),
    Check("missing API stays JSON", "/api/v1/unknown", 404, "application/json", '"Unknown API route."'),
)


def fail(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def fetch(path: str) -> tuple[int, str, str, str]:
    request = Request(urljoin(f"{BASE_URL}/", path.lstrip("/")), method="GET")
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, response.headers.get("Content-Type", ""), body, response.geturl()
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return error.code, error.headers.get("Content-Type", ""), body, error.geturl()


def main() -> int:
    if not BASE_URL:
        return fail("set EQUO_BASE_URL to the deployed site, for example https://example.vercel.app")

    for check in CHECKS:
        try:
            status, content_type, body, final_url = fetch(check.path)
        except (TimeoutError, URLError) as error:
            return fail(f"{check.label}: request failed: {error}")

        if status != check.status:
            return fail(f"{check.label}: expected status {check.status}, got {status}; final_url={final_url}; body={body[:240]}")

        if check.content_type_contains not in content_type:
            return fail(
                f"{check.label}: expected content type containing {check.content_type_contains!r}, "
                f"got {content_type!r}; body={body[:240]}"
            )

        if check.body_contains and check.body_contains not in body:
            return fail(f"{check.label}: expected body marker {check.body_contains!r}; body={body[:240]}")

    print("PASS: production web smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
