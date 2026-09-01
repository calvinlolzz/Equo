from __future__ import annotations

import re
import sys
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DIST = ROOT / "apps" / "web" / "dist"

HOME_REQUIRED_MARKERS = ("使用 Google 登入", "建立群組", "加入群組", "繼續使用")

# The dev-only screenshot harness (apps/web/screenshot.html + src/screenshot.tsx)
# mounts the real app against a FABRICATED group, so that a store screenshot can
# be taken without photographing somebody's real expenses. It is kept out of the
# build by Vite's default single-entry behaviour, which is an implicit guarantee
# — one line in a vite config would silently ship a page that serves invented
# balances under a real domain. So it is asserted here instead of assumed.
FORBIDDEN_DIST_FILES = ("screenshot.html",)


def collect_dist_text(dist_dir: Path) -> str:
    index_path = dist_dir / "index.html"
    if not index_path.exists():
        raise FileNotFoundError(f"missing {index_path}")

    html = index_path.read_text(encoding="utf-8", errors="replace")
    parts = [html]
    asset_paths = re.findall(r'''["'](/?assets/[^"']+\.(?:js|css))["']''', html)

    for asset_path in asset_paths:
        normalized = asset_path.lstrip("/")
        path = dist_dir / normalized
        if path.exists():
            parts.append(path.read_text(encoding="utf-8", errors="replace"))

    return "\n".join(parts)


def validate_dist_home(dist_dir: Path = DEFAULT_DIST) -> bool:
    text = collect_dist_text(dist_dir)
    return all(marker in text for marker in HOME_REQUIRED_MARKERS)


def leaked_dev_pages(dist_dir: Path = DEFAULT_DIST) -> list[str]:
    """Dev-only pages that must never be part of a deployment."""
    return [name for name in FORBIDDEN_DIST_FILES if (dist_dir / name).exists()]


def main() -> int:
    try:
        leaked = leaked_dev_pages()
        if leaked:
            print(f"FAIL: dev-only page(s) in the build: {', '.join(leaked)}")
            return 1

        if validate_dist_home():
            print("PASS: built web bundle keeps the login wall and create/join/continue flow, no dev-only pages")
            return 0
    except FileNotFoundError as error:
        print(f"FAIL: {error}")
        return 1

    print("FAIL: built web bundle is missing the login wall or create/join/continue markers")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
