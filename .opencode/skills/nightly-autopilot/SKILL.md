---
name: nightly-autopilot
description: Run bounded unattended delivery loops for Monica Telegram assistant work with contract, planning, review, and test gates until completion or explicit stop conditions.
---

# Nightly Autopilot

## Purpose
Enable long-running unattended execution without losing scope control, quality, or safety.

## Preconditions
1. A complete task contract exists from `task-contract`.
2. Objective, scope, and acceptance criteria are explicit.
3. Execution mode is explicitly set to unattended.
4. Runtime and cycle limits are explicit:
- `MinRuntimeHours`
- `MinCycles`
- `MaxCycles`
5. Backlog policy is explicit (single-slice or continuous multi-slice).
6. Required validations and reviewer threshold are explicit.

## Loop
1. Establish baseline:
- failing tests
- open reviewer findings
- unresolved in-scope backlog
2. Rank next in-scope slice by impact and risk.
3. If architecture scope changed, run `architecture-planner` + `architecture-patterns` guidance before edits.
4. Implement one small vertical slice.
5. Run reviewer checks.
6. Run required tests/smokes.
7. Record cycle results, deltas, and residual risks.
8. Continue until completion gate or stop conditions trigger.

## Stop conditions
1. Hard blocker with evidence.
2. `MaxCycles` reached.
3. Scope conflict or contradictory constraints.
4. No-progress plateau across consecutive cycles.
5. Completion gate satisfied after `MinRuntimeHours` and `MinCycles`.

## Completion gate
Declare completion only when all are true:
1. Acceptance criteria are satisfied.
2. Required tests/smokes pass.
3. No unresolved high/medium reviewer findings.
4. Must-preserve behavior remains intact.
5. `MinRuntimeHours` and `MinCycles` are satisfied unless stopped by blocker/plateau.
6. No high-impact in-scope backlog remains.

## Logging requirement
Record each cycle in `docs/debug/YYYY-MM-DD-nightly-cycle<N>.md` with:
1. selected slice,
2. key edits/files touched,
3. tests and review outputs,
4. remaining backlog,
5. stop-condition status.
