from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


REQUIRED = {
    "vercel.json": [
        '"installCommand": "npm install"',
        # The VITE_COMMIT_SHA prefix is what lets a deploy be verified from the
        # outside: it maps Vercel's own commit into the build so index.html can
        # carry it and smoke-production-web.py can tell "the site is up" from
        # "my commit is live". Dropping it costs nothing visible - the site
        # still builds and still serves - so it is pinned here.
        '"buildCommand": "VITE_COMMIT_SHA=$VERCEL_GIT_COMMIT_SHA npm run build"',
        '"outputDirectory": "apps/web/dist"',
        # Every /api/v1/* path must be handed to the catch-all function.
        #
        # This rule is NOT redundant with Vercel's filesystem routing, which is
        # what the legacy `routes` block was assumed to fall back on when it was
        # migrated to `rewrites`: dropping it took production's entire API down
        # for anything with two or more path segments (GET /api/v1/groups/:id,
        # the expense routes, invites, settlement, the admin console - all of
        # them 404'd at the edge, never reaching the function), while
        # single-segment paths like /api/v1/groups kept working and hid it.
        # Guarded here because nothing else can catch its absence.
        '"source": "/api/v1/(.*)"',
        '"destination": "/api/v1/[...path]"',
        # SPA fallback for deep links, with /api/ excluded so API calls fall
        # through to the rule above (rewrites replaced the legacy routes block
        # so the headers block below could be added - the two keys are mutually
        # exclusive in vercel.json).
        #
        # The marker is the negative lookahead alone, not the whole rule. It
        # used to pin the exact string, which meant adding a second exclusion
        # (`|assets/`, in 7f84cd6, so a stale tab's chunk request 404s instead
        # of being handed index.html) turned this guard red on main for a week
        # while the thing it guards was never at risk. What must not vanish is
        # the API exclusion; further exclusions are ordinary routing changes.
        '"source": "/((?!api/',
        '"destination": "/index.html"',
        # Security headers (review report issue 4). CSP must stay present.
        '"Content-Security-Policy"',
        '"X-Frame-Options"',
        '"X-Content-Type-Options"',
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
    # The other half of the deploy-verification chain: the page has to carry the
    # commit for the smoke script to have anything to compare against.
    "apps/web/index.html": [
        'name="equo-commit"',
        "%VITE_COMMIT_SHA%",
    ],
    "scripts/smoke-production-web.py": [
        "EQUO_BASE_URL",
        "EQUO_EXPECTED_COMMIT",
        "HOME_REQUIRED_MARKERS",
        "collect_home_shell_text",
        "validate_home_experience",
        "read_commit_marker",
        "commit_matches",
        "/group/smoke-test",
        "/api/v1/unknown",
        "application/json",
        "production web smoke checks passed",
    ],
    "scripts/test-smoke-production-web.py": [
        "valid_home",
        "missing_login_wall",
        "read_commit_marker",
        "commit_matches",
        "production web smoke rules verified",
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
