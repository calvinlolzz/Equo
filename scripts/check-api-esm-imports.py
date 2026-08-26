#!/usr/bin/env python3
"""Every relative import the API function pulls in must carry a .js extension.

Why this exists
---------------

The Vercel function runs as native Node ESM, where a relative specifier has to
name the file exactly: `./uiText` does not resolve, `./uiText.js` does. Vite and
Vitest both resolve the extensionless form perfectly happily, so a missing
extension type-checks, builds, passes 1600 tests, and then 500s on every single
API route in production.

That is not hypothetical. Adding `import { ACTIVE_LOCALE } from "./uiText"` to
formatAmount.ts - a client module the push code imports - took the whole API
down, and nothing in the pipeline noticed because nothing in the pipeline
resolves modules the way Node does.

The trap is specifically at the client boundary. Files under server/ have always
written `.js` because that is the local habit; files under app/ have not needed
to, because Vite bundles them. The moment a server module imports a client one,
that client module's own imports become Node's problem too.

So: walk the real graph from the function entry, and require the extension on
every relative hop.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENTRY = ROOT / "vercel-api" / "v1Handler.ts"

# `from "..."` and `import("...")`, skipping bare package specifiers.
IMPORT_RE = re.compile(r"""(?:from|import)\s*\(?\s*["'](\.[^"']+)["']""")


def resolve(importer: Path, specifier: str) -> Path | None:
    """The file a specifier points at, mirroring how the bundler finds it."""
    target = (importer.parent / specifier).resolve()

    # A .js specifier in TypeScript source means the .ts file beside it.
    if target.suffix == ".js":
        for candidate in (target.with_suffix(".ts"), target.with_suffix(".tsx"), target):
            if candidate.is_file():
                return candidate
        return None

    for candidate in (
        target,
        target.with_suffix(".ts"),
        target.with_suffix(".tsx"),
        target / "index.ts",
    ):
        if candidate.is_file():
            return candidate
    return None


def main() -> int:
    if not ENTRY.is_file():
        print(f"FAIL: API entry point not found at {ENTRY}")
        return 1

    seen: set[Path] = set()
    queue = [ENTRY]
    problems: list[str] = []
    unresolved: list[str] = []

    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)

        source = current.read_text(encoding="utf-8")
        for specifier in IMPORT_RE.findall(source):
            if not specifier.endswith(".js"):
                problems.append(f"{current.relative_to(ROOT)} -> {specifier}")
                # Still follow it, so one missing extension does not hide the
                # rest of the graph behind it.
            target = resolve(current, specifier)
            if target is None:
                unresolved.append(f"{current.relative_to(ROOT)} -> {specifier}")
                continue
            queue.append(target)

    if unresolved:
        print("FAIL: import specifiers that do not resolve to a file:")
        for entry in sorted(unresolved):
            print(f"  {entry}")
        return 1

    if problems:
        print("FAIL: relative imports reachable from the API function are missing")
        print("      the .js extension that native Node ESM requires.")
        print("      These resolve under Vite and Vitest and 500 in production:")
        for entry in sorted(problems):
            print(f"  {entry}")
        return 1

    print(f"PASS: API function module graph is Node-ESM resolvable ({len(seen)} files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
