# Orchestrate Runner

Sequential task runner that invokes Claude Code's `/orchestrate --auto --single-task` in a loop, giving each task a fresh context window. Tracks progress via `.claude-work/*/state.json` and stops when all tasks complete or no progress is detected.

When run inside a **psmux** session, the runner automatically opens a side pane showing live Claude output — no manual setup needed.

## Prerequisites

- Claude Code CLI (`claude`) in PATH
- [psmux](https://psmux.pages.dev/) installed (`scoop install psmux` or `cargo install psmux`)
- Node.js + pnpm (already set up in the monorepo)

## Quick Start

```bash
# 1. Start a psmux session
psmux new-session -s orch

# 2. Run the orchestrator (it auto-opens the agent pane)
cd scripts/orchestrate-runner
npx tsx run.ts
```

That's it. The runner detects the psmux session and splits a pane automatically:

```
┌──────────────────────┬──────────────────────────────────────┐
│                      │                                      │
│  Runner              │  Agent Pane (auto-created)           │
│  (status, progress)  │  (live Claude output per run)        │
│                      │                                      │
│                      │                                      │
└──────────────────────┴──────────────────────────────────────┘
```

The left pane shows runner progress (run number, completed/failed counts). The right pane shows the full Claude output for the current task, updated live each run.

### Without psmux

If you run outside a psmux session, the runner falls back to inline output (piped through the runner process). You can still tail logs in a separate terminal:

```bash
# Terminal 1: run the orchestrator
npx tsx run.ts

# Terminal 2: watch live output
tail -f .claude-work/logs/run-latest.log
```

## CLI Options

```
--timeout <minutes>        Timeout per task invocation (default: 120)
--max-no-progress <N>      Stop after N runs without progress (default: 3)
--max-runs <N>             Safety cap on total runs (default: 50)
--filter <task-name>       Only run tasks matching this name
--help                     Show help
```

Examples:

```bash
# Run all tasks with defaults
npx tsx run.ts

# 60-minute timeout, stop after 5 stalls
npx tsx run.ts --timeout 60 --max-no-progress 5

# Only run tasks matching "Auth"
npx tsx run.ts --filter "Auth"
```

## Log Files

Each Claude invocation writes to its own log file:

```
.claude-work/
  runner.log                    # High-level runner status (all runs)
  logs/
    run-001-2026-03-23T...log   # Full output from run 1
    run-002-2026-03-23T...log   # Full output from run 2
    run-latest.log              # Always contains the current run's output
```

- `runner.log` — one-line-per-event summary (task started, completed, failed, timed out)
- `run-NNN-*.log` — complete Claude stdout/stderr for that invocation
- `run-latest.log` — continuously updated with the current run's output, stable path for `tail -f`

## psmux Cheat Sheet

| Shortcut         | Action                              |
| ---------------- | ----------------------------------- |
| `Ctrl+B %`       | Split pane vertically (add a pane)  |
| `Ctrl+B "`       | Split pane horizontally             |
| `Ctrl+B arrow`   | Move focus between panes            |
| `Ctrl+B z`       | Zoom/unzoom current pane            |
| `Ctrl+B d`       | Detach (session keeps running)      |
| `Ctrl+B x`       | Close current pane                  |

```bash
# Detach from session (everything keeps running)
Ctrl+B d

# Reattach later
psmux attach -t orch

# List active sessions
psmux ls
```

## How It Works

1. Detects whether it's inside a psmux session (`$TMUX` env var)
2. If yes: creates an agent pane via `psmux split-window`
3. For each task run:
   - Writes a wrapper shell script that runs `claude -p` and tees output to log files
   - In psmux mode: sends the script to the agent pane via `psmux send-keys` — Claude runs with full terminal output visible in the pane
   - In fallback mode: spawns Claude as a child process with piped stdout/stderr
4. Detects completion via sentinel file (psmux) or process exit (fallback)
5. Diffs `.claude-work/*/state.json` before/after to detect completed/failed tasks
6. Repeats until all tasks are done, N consecutive stalls, or safety cap hit
7. Prints a final summary

On timeout, the runner sends `Ctrl+C` to the agent pane (psmux) or uses `taskkill /F /T` to kill the process tree (Windows fallback).
