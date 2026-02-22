#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def next_index(base_dir: Path) -> int:
    max_index = 0
    if not base_dir.exists():
        return 1

    for child in base_dir.iterdir():
        if not child.is_dir():
            continue
        name = child.name
        if len(name) < 4 or name[3] != "-":
            continue
        prefix = name[:3]
        if not prefix.isdigit():
            continue
        max_index = max(max_index, int(prefix))
    return max_index + 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Create indexed spec directory.")
    parser.add_argument("short_name", help="kebab-case spec short name")
    parser.add_argument("--base-dir", default="context/spec", help="Base spec directory")
    args = parser.parse_args()

    base = Path(args.base_dir)
    index = next_index(base)
    if index > 999:
        raise SystemExit("Error: next index would exceed 999.")

    directory = base / f"{index:03d}-{args.short_name}"
    directory.mkdir(parents=True, exist_ok=True)
    print(f"Created: {directory.as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
