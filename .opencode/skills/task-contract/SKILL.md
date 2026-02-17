---
name: task-contract
description: Build a strict contract for Monica Telegram assistant delivery work by collecting missing requirements, defining measurable quality gates, and setting explicit execution stop conditions.
---

# Task Contract

## Purpose
Prevent ambiguous execution by requiring a complete, measurable contract before implementation.

## Required contract fields
1. Objective and success outcome.
2. Scope in and scope out.
3. Affected services/modules.
4. Must-preserve behavior and compatibility constraints.
5. Required validations (tests/smokes).
6. Quality targets:
- reviewer severity threshold,
- architecture constraints from PRD,
- TDD requirement (default enabled unless user explicitly waives),
- any explicit quality score targets if provided by user.
7. Execution mode:
- interactive or unattended.
8. Backlog policy:
- single-slice or continuous multi-slice.
9. Stop conditions:
- `MinRuntimeHours`,
- `MinCycles`,
- `MaxCycles`,
- escalation triggers,
- no-progress threshold.

## Intake workflow
1. Detect missing required fields.
2. Ask concise blocking questions for missing fields (1-3 per round).
3. For unattended requests, require explicit runtime/cycle/backlog fields before using defaults.
4. Confirm assumptions explicitly.
5. Publish final contract before implementation.

## Execution notes
1. Route contract completion to orchestration before edits.
2. For implementation work, activate `test-driven-development` and enforce RED -> GREEN -> REFACTOR.
3. If scope crosses service boundaries or adds new integration flows, require architecture-planner guidance before implementation.
4. If execution mode is unattended, activate `nightly-autopilot`.

## Completion gate
Declare completion only when all are true:
1. Acceptance criteria are satisfied.
2. Must-preserve functionality is intact.
3. Required tests/smokes pass.
4. Reviewer has no unresolved high/medium findings.
