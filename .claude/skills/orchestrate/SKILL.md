---
name: orchestrate
description: >
  Multi-agent pipeline orchestrator for executing roadmap tasks. Reads
  context/product/roadmap.md, picks the next unchecked task group, and runs it
  through planner → plan-reviewer → implementer → code-reviewer → smoke-tester
  → committer agents with feedback loops and quality gates. Supports --manual
  (pause for human review) and --auto (fully autonomous) modes.
user-invocable: true
---

# Roadmap Orchestrator

Execute roadmap tasks through a multi-agent pipeline with quality gates and feedback loops.

## Invocation

```
/orchestrate [mode] [task-filter]
```

- `mode`:
  - `--manual` (default): Pause for user approval after each pipeline phase
  - `--auto`: Run fully autonomously — moves through all tasks and phases, pauses only on repeated failures
- `task-filter`: Optional task group name (e.g., "Setup-Link Authentication")
  - If omitted, picks the next unchecked task group from the roadmap

## Agents

Six dedicated agents are defined in `.claude/agents/`. Each runs with clean context and communicates through files in `.claude-work/{task-id}/`.

| Agent | `subagent_type` | Role |
|-------|-----------------|------|
| Planner | `planner` | Creates implementation plan from roadmap task |
| Plan Reviewer | `plan-reviewer` | Reviews plan for KISS/SOLID/DRY/security/boundaries |
| Implementer | `implementer` | Writes code and tests following approved plan |
| Code Reviewer | `code-reviewer` | Reviews code, runs biome + vitest, enforces rules |
| Smoke Tester | `smoke-tester` | Runs Docker Compose smoke tests on live stack |
| Committer | `committer` | Creates git commits and updates roadmap |

## Pipeline

```
PLANNER ──► PLAN REVIEWER ──┐
   ▲                         │
   └── REJECTED (max 3) ◄───┘
                             │ APPROVED
                             ▼
IMPLEMENTER ──► CODE REVIEWER ──┐
   ▲                             │
   └── REJECTED (max 3) ◄───────┘
                                 │ APPROVED
                                 ▼
                          SMOKE TESTER ──┐
   ▲                                     │
   └── FAIL (max 2) ◄───────────────────┘
                                         │ PASS
                                         ▼
                                     COMMITTER ──► next task (auto) or stop (manual)
```

## Process

Follow precisely. Do not skip steps.

---

### Step 0: Initialize

1. Read `context/product/roadmap.md`.
2. Parse task groups (bold `**Name**` items with `- [ ]`/`- [x]` sub-items under Phase headings).
3. If `task-filter` provided: find matching group. Not found → report and stop.
4. If no filter: find first group with at least one `[ ]` sub-item.
5. All checked → report "All roadmap tasks are complete" and stop.
6. Derive `task-id` from group name (kebab-case, e.g., `setup-link-authentication`).
7. Check `.claude-work/{task-id}/state.json`:
   - `"status": "in-progress"` → announce resumption, skip to recorded phase.
   - `"status": "completed"` → skip to next unchecked group.
   - Missing → create directory and initialize state.

**State file** `.claude-work/{task-id}/state.json`:
```json
{
  "taskId": "setup-link-authentication",
  "taskGroup": "Setup-Link Authentication",
  "phase": "planning",
  "planAttempts": 0,
  "codeAttempts": 0,
  "smokeAttempts": 0,
  "status": "in-progress",
  "mode": "manual|auto",
  "startedAt": "ISO-timestamp"
}
```

8. `--manual` only: show task group + sub-items, wait for user confirmation.

---

### Step 1: Planning

Spawn the **`planner`** agent. Construct a prompt containing:

- The full task group name and all sub-items from the roadmap
- Instruction to read: `context/product/roadmap.md`, `architecture.md`, `service-architecture.md`, `product-definition.md`, `acceptance-criteria.md`, `adr-v1-deployment-profile.md`, `monica-api-scope.md` (if relevant), all `.claude/rules/*.md`, and relevant existing source in `packages/` and `services/`
- If retry: instruction to read `.claude-work/{task-id}/plan-review-{N}.md` and address all CRITICAL/HIGH findings
- Output path: `.claude-work/{task-id}/plan.md`

Update state: `"phase": "planning"`, increment `planAttempts`.

---

### Step 2: Plan Review

Spawn the **`plan-reviewer`** agent. Construct a prompt containing:

- Path to plan: `.claude-work/{task-id}/plan.md`
- Instruction to read all `.claude/rules/*.md` and `context/product/architecture.md`, `service-architecture.md`, `acceptance-criteria.md`
- If re-review: path to previous review `.claude-work/{task-id}/plan-review-{N-1}.md`
- Output path: `.claude-work/{task-id}/plan-review.md` (or `plan-review-{attempt}.md` on retries)

**After agent returns:**
1. Read the review file. Check `verdict:` in frontmatter.
2. `REJECTED` + `planAttempts < 3` → back to Step 1 with review as feedback.
3. `REJECTED` + `planAttempts >= 3` → set `"status": "failed"`, report findings, stop.
4. `APPROVED` → update state `"phase": "implementing"`.
   - `--manual`: show plan summary, wait for confirmation.

---

### Step 3: Implementation

Spawn the **`implementer`** agent. Construct a prompt containing:

- Path to plan: `.claude-work/{task-id}/plan.md`
- Path to approved review: `.claude-work/{task-id}/plan-review.md`
- If retry after code review: path to `.claude-work/{task-id}/code-review-{N}.md` + instruction to fix CRITICAL/HIGH findings
- If retry after smoke failure: path to `.claude-work/{task-id}/smoke-report-{N}.md` + instruction to fix root causes
- Output path: `.claude-work/{task-id}/impl-summary.md`

Update state: `"phase": "implementing"`, increment `codeAttempts`.

---

### Step 4: Code Review

Spawn the **`code-reviewer`** agent. Construct a prompt containing:

- Path to impl summary: `.claude-work/{task-id}/impl-summary.md`
- Path to approved plan: `.claude-work/{task-id}/plan.md`
- Instruction to read all `.claude/rules/*.md`
- If re-review: path to previous review
- Output path: `.claude-work/{task-id}/code-review.md` (or `code-review-{attempt}.md`)

**After agent returns:**
1. Read review file. Check `verdict:`.
2. `REJECTED` + `codeAttempts < 3` → back to Step 3 with review as feedback.
3. `REJECTED` + `codeAttempts >= 3` → set `"status": "failed"`, report, stop.
4. `APPROVED` → update state `"phase": "smoke-testing"`.
   - `--manual`: show review summary, wait for confirmation.

---

### Step 5: Smoke Testing

Spawn the **`smoke-tester`** agent. Construct a prompt containing:

- Path to impl summary: `.claude-work/{task-id}/impl-summary.md`
- Path to plan: `.claude-work/{task-id}/plan.md`
- Paths to `docker-compose.yml` and `docker/caddy/Caddyfile` (if exists)
- If re-test: path to previous smoke report
- Output path: `.claude-work/{task-id}/smoke-report.md` (or `smoke-report-{attempt}.md`)

Update state: increment `smokeAttempts`.

**After agent returns:**
1. Read smoke report. Check `verdict:`.
2. `FAIL` + `smokeAttempts < 2` → back to Step 3 (Implementer) with smoke report as feedback.
3. `FAIL` + `smokeAttempts >= 2` → set `"status": "failed"`, report, stop.
4. `PASS` → update state `"phase": "committing"`.
   - `--manual`: show smoke results, wait for confirmation.

---

### Step 6: Commit

Spawn the **`committer`** agent. Construct a prompt containing:

- Work directory: `.claude-work/{task-id}/`
- Task group name for the roadmap update
- Paths to all report files (plan, review, impl-summary, code-review, smoke-report)

Update state: `"phase": "completed"`, `"status": "completed"`, set `"completedAt"`.

---

### Step 7: Next Task

**`--auto` mode:**
1. Report: "Completed: {task group}. Moving to next task."
2. Go to Step 0. Pick the next unchecked task group (across ALL phases).
3. Continue until all tasks complete or a task fails after max retries.
4. On failure: log it, move to next task. Report all skipped/failed tasks at the end.
5. When all tasks are done: report final summary of all completed and failed tasks, then stop.

**`--manual` mode:**
1. Report: task completed, files changed, commit hashes, residual risks.
2. Ask: "Continue to the next task group?"
3. Yes → Step 0. No → stop.

---

## Error Handling

- **No verdict file produced:** Retry the same agent once. Second failure → `"status": "failed"`, report to user.
- **Max retries exceeded:** `"status": "failed"`. Report accumulated findings.
- **Infrastructure failure** (docker, npm): Report and stop. No auto-retry.
- **`--manual`:** Always pause on failure for user decision.
- **`--auto`:** On failure after max retries, skip task, continue to next. Report all failures at end.

## Resumption

1. On invocation, check `.claude-work/*/state.json` for `"status": "in-progress"`.
2. If found: "Found in-progress task: {taskGroup} at phase: {phase}. Resume?"
3. Resume → skip to recorded phase. Files from prior steps are still available.
4. Don't resume → archive old directory, start fresh.

## File Structure

```
.claude-work/
├── {task-id}/
│   ├── state.json
│   ├── plan.md
│   ├── plan-review.md
│   ├── impl-summary.md
│   ├── code-review.md
│   └── smoke-report.md
```

## Rules

- Never skip plan review, code review, or smoke tests.
- Never stage `.claude-work/` files in commits.
- Keep orchestrator context minimal — only track task IDs, phases, and verdicts. All details live in files.
- Each agent prompt must include the task-specific file paths. The agent definition in `.claude/agents/` provides the role and behavior.
