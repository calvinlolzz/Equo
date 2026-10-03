from __future__ import annotations

import os
import re
import subprocess
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

# Optional. Set it to the commit that should be live to turn this script from
# "the site is healthy" into "the deploy landed" - the markers below are stable
# UI copy, so a previous deployment satisfies every one of them. Accepts a SHA,
# or the literal "HEAD" to resolve the checkout's own commit.
EXPECTED_COMMIT = os.environ.get("EQUO_EXPECTED_COMMIT", "").strip()


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
    # The LINE link card's hero image is fetched by LINE's servers. A typo or a
    # missing file anywhere outside /assets/ would silently come back as the
    # SPA's index.html (200 text/html); under /assets/ it is a real 404.
    Check("LINE link hero image", "/assets/line/link-hero-v1.jpg", 200, "image/jpeg", ""),
    Check("missing asset is a 404, not the SPA", "/assets/line/missing-v0.jpg", 404, "", ""),
)

HOME_REQUIRED_MARKERS = ("使用 Google 登入", "建立群組", "加入群組", "繼續使用")

COMMIT_META_RE = re.compile(r'<meta\s+name="equo-commit"\s+content="([^"]*)"', re.IGNORECASE)
SHA_RE = re.compile(r"^[0-9a-f]{7,40}$", re.IGNORECASE)


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


def validate_home_experience(body: str) -> bool:
    return all(marker in body for marker in HOME_REQUIRED_MARKERS)


def read_commit_marker(html: str) -> str | None:
    """
    The commit the served bundle was built from, or None when it carries no
    usable stamp. A build without VITE_COMMIT_SHA leaves Vite's `%VITE_...%`
    placeholder in place, so "the tag exists" is not enough - it has to look
    like a SHA before it is worth comparing against anything.
    """
    match = COMMIT_META_RE.search(html)
    if not match:
        return None
    value = match.group(1).strip()
    return value.lower() if SHA_RE.match(value) else None


def commit_matches(deployed: str, expected: str) -> bool:
    """
    Prefix comparison in both directions, so a short SHA from `git rev-parse
    --short HEAD` matches a full one and vice versa. Both sides must be at
    least 7 characters: a shorter prefix is not enough to identify a commit,
    and silently accepting one would make this check worse than none.
    """
    deployed = deployed.strip().lower()
    expected = expected.strip().lower()
    if len(deployed) < 7 or len(expected) < 7:
        return False
    return deployed.startswith(expected) or expected.startswith(deployed)


def resolve_expected_commit(value: str) -> str:
    """`HEAD` means "whatever this checkout is on", so the caller does not have
    to paste a SHA. Anything else is passed through untouched."""
    if value.upper() != "HEAD":
        return value
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def collect_home_shell_text(home_html: str) -> str:
    asset_paths = re.findall(r'''["'](/assets/[^"']+\.(?:js|css))["']''', home_html)
    parts = [home_html]

    for asset_path in asset_paths:
        try:
            status, _content_type, asset_body, _final_url = fetch(asset_path)
        except (TimeoutError, URLError):
            continue
        if status == 200:
            parts.append(asset_body)

    return "\n".join(parts)


def main() -> int:
    if not BASE_URL:
        return fail("set EQUO_BASE_URL to the deployed site, for example https://example.vercel.app")

    home_html = ""

    for check in CHECKS:
        try:
            status, content_type, body, final_url = fetch(check.path)
        except (TimeoutError, URLError) as error:
            return fail(f"{check.label}: request failed: {error}")

        if check.label == "home":
            home_html = body

        if status != check.status:
            return fail(f"{check.label}: expected status {check.status}, got {status}; final_url={final_url}; body={body[:240]}")

        if check.content_type_contains not in content_type:
            return fail(
                f"{check.label}: expected content type containing {check.content_type_contains!r}, "
                f"got {content_type!r}; body={body[:240]}"
            )

        if check.body_contains and check.body_contains not in body:
            return fail(f"{check.label}: expected body marker {check.body_contains!r}; body={body[:240]}")

        if check.label == "home" and not validate_home_experience(collect_home_shell_text(body)):
            return fail(
                "home: expected the login wall copy and the create/join/continue flow in the bundle; "
                f"body={body[:240]}"
            )

    deployed_commit = read_commit_marker(home_html)
    print(f"INFO: deployed commit {deployed_commit}" if deployed_commit else "INFO: deployment carries no commit stamp")

    if EXPECTED_COMMIT:
        expected = resolve_expected_commit(EXPECTED_COMMIT)
        if not expected:
            return fail("EQUO_EXPECTED_COMMIT=HEAD but `git rev-parse HEAD` failed; pass an explicit SHA instead")
        if not deployed_commit:
            return fail(
                "EQUO_EXPECTED_COMMIT is set but the deployment carries no commit stamp; "
                "it predates the stamp, or the build ran without VITE_COMMIT_SHA"
            )
        if not commit_matches(deployed_commit, expected):
            return fail(
                f"deployed commit {deployed_commit} does not match expected {expected}; "
                "the build may still be running or the alias has not flipped yet"
            )
        print(f"PASS: deployed commit matches {expected}")

    print("PASS: production web smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
