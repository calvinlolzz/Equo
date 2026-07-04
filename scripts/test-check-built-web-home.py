from __future__ import annotations

import importlib.util
import sys
import tempfile
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("check-built-web-home.py")


def load_module():
    spec = importlib.util.spec_from_file_location("check_built_web_home", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load check-built-web-home.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def write_dist(root: Path, asset_text: str) -> None:
    assets = root / "assets"
    assets.mkdir(parents=True)
    (root / "index.html").write_text(
        '<div id="root"></div><script type="module" src="/assets/index-test.js"></script>',
        encoding="utf-8",
    )
    (assets / "index-test.js").write_text(asset_text, encoding="utf-8")


def main() -> int:
    module = load_module()

    with tempfile.TemporaryDirectory() as tmp:
      valid_dist = Path(tmp) / "valid"
      valid_dist.mkdir()
      write_dist(valid_dist, "建立群組 加入群組 繼續使用")
      if not module.validate_dist_home(valid_dist):
          print("FAIL: expected valid dist home to pass")
          return 1

      login_dist = Path(tmp) / "login"
      login_dist.mkdir()
      write_dist(login_dist, "使用 Equo 使用 Google 登入 使用 Apple 登入")
      if module.validate_dist_home(login_dist):
          print("FAIL: expected login gate dist home to fail")
          return 1

    print("PASS: built web home rules verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
