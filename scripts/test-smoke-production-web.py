from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("smoke-production-web.py")


def load_module():
    spec = importlib.util.spec_from_file_location("smoke_production_web", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load smoke-production-web.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    module = load_module()
    valid_home = "\n".join(["Equo", "使用 Google 登入", "建立群組", "加入群組", "繼續使用"])
    missing_login_wall = "\n".join(["Equo", "建立群組", "加入群組", "繼續使用"])
    missing_start_flow = "\n".join(["Equo", "使用 Google 登入"])

    if not module.validate_home_experience(valid_home):
        print("FAIL: expected login wall + create/join/continue bundle to pass")
        return 1

    if module.validate_home_experience(missing_login_wall):
        print("FAIL: expected bundle missing the login wall copy to fail")
        return 1

    if module.validate_home_experience(missing_start_flow):
        print("FAIL: expected bundle missing create/join/continue markers to fail")
        return 1

    print("PASS: production web smoke rules verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
