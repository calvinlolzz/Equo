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

    stamped = '<meta name="equo-commit" content="bb6a6569720f93c100d7f5f072a6f42c1a834814" />'
    # What a build that never received VITE_COMMIT_SHA actually ships. Reading
    # this as a commit would make every comparison against it fail confusingly,
    # so it has to come back as "unstamped" instead.
    unstamped = '<meta name="equo-commit" content="%VITE_COMMIT_SHA%" />'

    if module.read_commit_marker(stamped) != "bb6a6569720f93c100d7f5f072a6f42c1a834814":
        print("FAIL: expected a stamped commit meta to be read back")
        return 1

    if module.read_commit_marker(unstamped) is not None:
        print("FAIL: expected an unsubstituted %VITE_% placeholder to read as unstamped")
        return 1

    if module.read_commit_marker("<html><head></head></html>") is not None:
        print("FAIL: expected a page with no commit meta to read as unstamped")
        return 1

    if not module.commit_matches("bb6a6569720f93c100d7f5f072a6f42c1a834814", "bb6a656"):
        print("FAIL: expected a short SHA to match the full deployed one")
        return 1

    if not module.commit_matches("bb6a656", "bb6a6569720f93c100d7f5f072a6f42c1a834814"):
        print("FAIL: expected a full SHA to match a short deployed one")
        return 1

    if module.commit_matches("bb6a6569720f93c100d7f5f072a6f42c1a834814", "7d7813f"):
        print("FAIL: expected a different commit to be rejected")
        return 1

    # A 3-char prefix collides far too easily to call a deploy verified.
    if module.commit_matches("bb6a6569720f93c100d7f5f072a6f42c1a834814", "bb6"):
        print("FAIL: expected a too-short expectation to be rejected")
        return 1

    print("PASS: production web smoke rules verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
