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
      write_dist(valid_dist, "使用 Google 登入 建立群組 加入群組 繼續使用")
      if not module.validate_dist_home(valid_dist):
          print("FAIL: expected valid dist home (login wall + create/join/continue) to pass")
          return 1

      missing_login_dist = Path(tmp) / "missing_login"
      missing_login_dist.mkdir()
      write_dist(missing_login_dist, "建立群組 加入群組 繼續使用")
      if module.validate_dist_home(missing_login_dist):
          print("FAIL: expected dist home missing the login wall copy to fail")
          return 1

      missing_start_flow_dist = Path(tmp) / "missing_start_flow"
      missing_start_flow_dist.mkdir()
      write_dist(missing_start_flow_dist, "使用 Google 登入")
      if module.validate_dist_home(missing_start_flow_dist):
          print("FAIL: expected dist home missing create/join/continue markers to fail")
          return 1

      # The dev-only screenshot harness must never be part of a deployment: it
      # renders the real app over invented balances.
      clean_dist = Path(tmp) / "clean"
      clean_dist.mkdir()
      write_dist(clean_dist, "x")
      if module.leaked_dev_pages(clean_dist):
          print("FAIL: expected a dist without screenshot.html to be clean")
          return 1

      leaky_dist = Path(tmp) / "leaky"
      leaky_dist.mkdir()
      write_dist(leaky_dist, "x")
      (leaky_dist / "screenshot.html").write_text("<html></html>", encoding="utf-8")
      if module.leaked_dev_pages(leaky_dist) != ["screenshot.html"]:
          print("FAIL: expected screenshot.html in dist to be reported")
          return 1

    print("PASS: built web home rules verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
