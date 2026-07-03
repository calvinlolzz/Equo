from __future__ import annotations

import sys
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]

TEXT_SUFFIXES = {
    ".css",
    ".html",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".py",
    ".sql",
    ".ts",
    ".tsx",
    ".txt",
    ".yml",
    ".yaml",
}

SKIP_DIRS = {
    ".git",
    ".vercel",
    "dist",
    "node_modules",
    "tmp",
}

MOJIBAKE_MARKERS = tuple(
    chr(codepoint)
    for codepoint in (
        0xFFFD,
        0xF24C,
        0xEE04,
        0xF699,
        0x8762,
        0x6470,
        0x929D,
        0x5697,
        0x64B1,
        0x761D,
        0x95AE,
        0x96A2,
    )
)


def iter_text_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        if path.suffix.lower() in TEXT_SUFFIXES:
            files.append(path)
    return files


def main() -> int:
    failures: list[str] = []

    for path in iter_text_files():
        rel = path.relative_to(ROOT)
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError as error:
            failures.append(f"{rel}: not valid UTF-8 ({error})")
            continue

        for line_number, line in enumerate(text.splitlines(), start=1):
            marker = next((item for item in MOJIBAKE_MARKERS if item in line), None)
            if marker:
                excerpt = line.strip()[:120]
                failures.append(f"{rel}:{line_number}: possible mojibake marker {marker!r}: {excerpt}")

    if failures:
        print("Encoding check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print(f"Encoding check passed: {len(iter_text_files())} UTF-8 text files scanned.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
