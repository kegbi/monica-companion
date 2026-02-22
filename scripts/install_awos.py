from __future__ import annotations

import argparse
import shutil
from pathlib import Path


SPEC_DIR_PY = """#!/usr/bin/env python3
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
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install AWOS assets into a project.")
    parser.add_argument(
        "--mode",
        choices=("claude", "awos"),
        default="awos",
        help="claude = core + Claude wrappers; awos = Claude + OpenCode wrappers",
    )
    parser.add_argument(
        "--source",
        default=str(Path("third_party") / "awos"),
        help="Path to AWOS source repository clone",
    )
    parser.add_argument(
        "--target",
        default=".",
        help="Target project root where files will be installed",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview actions without writing files",
    )
    return parser.parse_args()


def copy_tree(src: Path, dst: Path, dry_run: bool) -> int:
    if not src.exists():
        raise FileNotFoundError(f"Missing source path: {src}")

    copied = 0
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(src)
        destination = dst / relative
        if not dry_run:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
        copied += 1
    return copied


def write_text(path: Path, content: str, dry_run: bool) -> None:
    if dry_run:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def install(mode: str, source: Path, target: Path, dry_run: bool) -> None:
    core_commands = source / "commands"
    core_templates = source / "templates"
    core_scripts = source / "scripts"
    claude_wrappers = source / "claude" / "commands"
    opencode_wrappers = source / "opencode" / "commands"

    copied_total = 0
    copied_total += copy_tree(core_commands, target / ".awos" / "commands", dry_run)
    copied_total += copy_tree(core_templates, target / ".awos" / "templates", dry_run)
    copied_total += copy_tree(core_scripts, target / ".awos" / "scripts", dry_run)
    copied_total += copy_tree(
        claude_wrappers, target / ".claude" / "commands" / "awos", dry_run
    )

    # Always install cross-platform alternative for spec directory creation.
    write_text(target / ".awos" / "scripts" / "create-spec-directory.py", SPEC_DIR_PY, dry_run)

    if mode == "awos":
        copied_total += copy_tree(
            opencode_wrappers, target / ".opencode" / "commands" / "awos", dry_run
        )

    mode_label = "DRY-RUN" if dry_run else "APPLIED"
    print(f"[{mode_label}] Installed mode={mode}; files processed={copied_total}")


def main() -> int:
    args = parse_args()
    source = Path(args.source).resolve()
    target = Path(args.target).resolve()
    install(args.mode, source, target, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
