from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "install_awos.py"


def run_installer(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, str(SCRIPT_PATH), *args]
    return subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, check=False)


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def make_fake_awos_source(root: Path) -> Path:
    source = root / "awos-source"
    write_file(source / "commands" / "product.md", "source product command")
    write_file(
        source / "templates" / "product-definition-template.md",
        "source product template",
    )
    write_file(
        source / "scripts" / "create-spec-directory.sh",
        "#!/usr/bin/env bash\necho source\n",
    )
    write_file(
        source / "claude" / "commands" / "product.md",
        "---\n"
        "description: Product wrapper\n"
        "---\n\n"
        "Use `AskUserQuestion` tool for multiple-choice questions.\n\n"
        "Refer to the instructions located in this file: .awos/commands/product.md\n",
    )
    write_file(
        source / "opencode" / "commands" / "product.md",
        "---\n"
        "name: awos:product\n"
        "description: Product wrapper\n"
        "---\n\n"
        "Use `question` tool for multiple-choice questions.\n\n"
        "Refer to the instructions located in this file: .awos/commands/product.md\n",
    )
    return source


def test_claude_mode_installs_core_and_claude_wrappers_only(tmp_path: Path) -> None:
    source = make_fake_awos_source(tmp_path)
    target = tmp_path / "workspace"
    target.mkdir()

    result = run_installer(
        "--mode",
        "claude",
        "--source",
        str(source),
        "--target",
        str(target),
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr

    assert (target / ".awos" / "commands" / "product.md").exists()
    assert (target / ".awos" / "templates" / "product-definition-template.md").exists()
    assert (target / ".awos" / "scripts" / "create-spec-directory.sh").exists()
    assert (target / ".claude" / "commands" / "awos" / "product.md").exists()
    wrapper_text = (target / ".claude" / "commands" / "awos" / "product.md").read_text(
        encoding="utf-8"
    )
    assert "Refer to the instructions located in this file: .awos/commands/product.md" in wrapper_text

    assert not (target / ".opencode" / "commands" / "awos").exists()


def test_awos_mode_installs_opencode_wrappers_and_keeps_config_intact(tmp_path: Path) -> None:
    source = make_fake_awos_source(tmp_path)
    target = tmp_path / "workspace"
    target.mkdir()

    write_file(
        target / "opencode.jsonc",
        json.dumps(
            {
                "$schema": "https://opencode.ai/config.json",
                "default_agent": "orchestrator",
                "mcp": {
                    "tavily": {
                        "type": "remote",
                        "url": "https://mcp.tavily.com/mcp",
                        "enabled": True,
                    }
                },
                "command": {"hello": {"template": "noop", "description": "keep me"}},
            }
        ),
    )

    result = run_installer(
        "--mode",
        "awos",
        "--source",
        str(source),
        "--target",
        str(target),
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr

    assert (target / ".opencode" / "commands" / "awos" / "product.md").exists()
    opencode_wrapper = (
        target / ".opencode" / "commands" / "awos" / "product.md"
    ).read_text(encoding="utf-8")
    assert "name: awos:product" in opencode_wrapper
    assert "Refer to the instructions located in this file: .awos/commands/product.md" in opencode_wrapper

    config = json.loads((target / "opencode.jsonc").read_text(encoding="utf-8"))
    assert "command" in config
    assert "hello" in config["command"]
    assert "awos:product" not in config["command"]
    assert config["mcp"]["tavily"]["url"] == "https://mcp.tavily.com/mcp"


def test_dry_run_does_not_write_files(tmp_path: Path) -> None:
    source = make_fake_awos_source(tmp_path)
    target = tmp_path / "workspace"
    target.mkdir()

    result = run_installer(
        "--mode",
        "awos",
        "--source",
        str(source),
        "--target",
        str(target),
        "--dry-run",
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr

    assert not (target / ".awos").exists()
    assert not (target / ".claude").exists()
