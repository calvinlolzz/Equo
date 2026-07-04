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
    valid_home = "\n".join(["Equo", "建立群組", "加入群組", "繼續使用"])
    login_gate = "\n".join(["Equo", "使用 Equo", "使用 Google 登入", "使用 Apple 登入"])

    if not module.validate_home_experience(valid_home):
        print("FAIL: expected create/join/continue home to pass")
        return 1

    if module.validate_home_experience(login_gate):
        print("FAIL: expected login gate home to fail")
        return 1

    print("PASS: production web smoke rules verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
