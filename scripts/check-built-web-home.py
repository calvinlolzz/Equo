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

HOME_REQUIRED_MARKERS = ("建立群組", "加入群組", "繼續使用")
HOME_FORBIDDEN_MARKERS = ("使用 Equo", "使用 Google 登入", "使用 Apple 登入")


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
    return all(marker in text for marker in HOME_REQUIRED_MARKERS) and not any(marker in text for marker in HOME_FORBIDDEN_MARKERS)


def main() -> int:
    try:
        if validate_dist_home():
            print("PASS: built web home keeps create/join/continue flow")
            return 0
    except FileNotFoundError as error:
        print(f"FAIL: {error}")
        return 1

    print("FAIL: built web home was replaced by login gate or is missing create/join/continue markers")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
