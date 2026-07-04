from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "vercel.json": [
        '"installCommand": "npm install"',
        '"buildCommand": "npm run build"',
        '"outputDirectory": "apps/web/dist"',
        '"src": "/api/v1/(.*)"',
        '"dest": "/api/v1/[...path]"',
        '"handle": "filesystem"',
        '"dest": "/index.html"',
    ],
    "package.json": [
        '"check:launch-readiness"',
        '"check:built-web-home"',
        '"test:built-web-home"',
        '"test:smoke-web-rules"',
        '"smoke:production"',
        '"smoke:production:web"',
        '"smoke:production:all"',
        '"verify:release"',
    ],
    "scripts/check-built-web-home.py": [
        "HOME_REQUIRED_MARKERS",
        "collect_dist_text",
        "validate_dist_home",
        "built web bundle keeps the login wall and create/join/continue flow",
    ],
    "scripts/test-check-built-web-home.py": [
        "valid_dist",
        "login_dist",
        "built web home rules verified",
    ],
    "scripts/smoke-production-api.py": [
        "EQUO_BASE_URL",
        "EQUO_GOOGLE_ID_TOKEN",
        "/api/v1/unknown",
        "/api/v1/auth/google",
        "equo_session",
    ],
    "scripts/smoke-production-web.py": [
        "EQUO_BASE_URL",
        "HOME_REQUIRED_MARKERS",
        "collect_home_shell_text",
        "validate_home_experience",
        "/group/smoke-test",
        "/api/v1/unknown",
        "application/json",
        "production web smoke checks passed",
    ],
    "scripts/test-smoke-production-web.py": [
        "valid_home",
        "missing_login_wall",
        "production web smoke rules verified",
    ],
    "docs/launch_readiness_stage.md": [
        "Vercel Project Settings",
        "Required Environment Variables",
        "Login Wall",
        "Production Smoke Test",
        "Launch Gate",
        "auth_leaked_password_protection",
    ],
    "docs/DEPLOYMENT.md": [
        "api/v1/[...path].ts",
        "apps/web/dist",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SESSION_SECRET",
        "smoke-production-api.py",
        "harden_legacy_rpc_surface",
    ],
}


def main() -> int:
    failures: list[str] = []

    for relative_path, fragments in REQUIRED.items():
        path = ROOT / relative_path
        if not path.exists():
            failures.append(f"missing {relative_path}")
            continue

        text = path.read_text(encoding="utf-8")
        for fragment in fragments:
            if fragment not in text:
                failures.append(f"{relative_path}: missing marker {fragment!r}")

    if failures:
        print("FAIL: launch readiness stage incomplete")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS: launch readiness stage verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
