---
name: telegram-architecture-guard
description: Enforce Telegram-first Monica assistant service boundaries and data-flow contracts before implementation. Use when planning or reviewing non-trivial feature changes.
---

# Telegram Architecture Guard

## Required inputs
1. `AGENTS.md`
2. `docs/prd-telegram-first-plain-english.md`
3. Target feature/request

## Procedure
1. Map requested behavior to PRD service boundaries (Bot, Core, Monica Integration, Voice, Scheduler, Delivery).
2. Identify exact seams to use and where cross-cutting policies should live.
3. Verify no forbidden dependency direction is introduced.
4. Produce a contract with:
- file touch list,
- boundary decisions,
- compatibility impacts,
- test matrix.

## Exit criteria
1. Plan honors service boundaries and command-flow contracts.
2. Security, observability, and anti-spam implications are explicit.
