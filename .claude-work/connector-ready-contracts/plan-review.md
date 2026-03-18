---
verdict: APPROVED
reviewed: connector-ready-contracts/plan.md
date: 2026-03-17
---

# Plan Review: Connector-Ready Contracts

## Summary

The plan performs a thorough audit of Telegram-specific assumptions that have leaked beyond `telegram-bridge` into shared contracts and connector-neutral services. The analysis of existing code is accurate -- every finding was verified against the actual source files. The proposed fixes are appropriately scoped: widening the schema, removing hardcoded literals, making caller lists configurable, and adding static boundary-enforcement tests. There are no critical or high design issues, but several medium-severity items deserve attention during implementation.

## Findings

| ID | Severity | Finding | Recommendation |
|----|----------|---------|----------------|
| F1 | MEDIUM | **Step 3: Adding `connectorType`/`connectorRoutingId` to `ConfirmedCommandPayloadSchema` is incomplete.** The plan says to add these as optional fields, but does not specify who populates them. | Clarify: if fields are missing from `ConfirmedCommandPayload`, the command-worker should look them up from `user-management` (similar to how `reminder-poller` already fetches `UserScheduleResponse`). Do NOT require ai-router to carry these fields. |
| F2 | MEDIUM | **Step 1: Widening `connectorType` from `z.enum(["telegram"])` to `z.string().min(1)` removes compile-time safety.** | The `z.string().min(1)` approach is acceptable given the delivery registry catches invalid values, but the tradeoff should be explicitly acknowledged in the connector extension guide. |
| F3 | MEDIUM | **`connectorRoutingId: ""` is a functional bug, not just hardcoding.** `OutboundMessageIntentSchema` requires `z.string().min(1)`, so empty string fails validation at delivery. Command execution notifications and dead-letter error notifications may be silently failing. | Add a regression test. The user-management lookup fix resolves this, but note this is fixing a pre-existing bug. |
| F4 | MEDIUM | **Step 4: `CONNECTOR_URLS` as JSON env var adds parsing complexity.** | Consider prefix-based convention: `CONNECTOR_URL_TELEGRAM=http://telegram-bridge:3009`. Simpler to configure in Docker Compose YAML, avoids JSON parsing. If JSON is used, validate with Zod schema. |
| F5 | LOW | **Step 5: Config pattern for `INBOUND_ALLOWED_CALLERS` is duplicated across services.** | Extract a shared helper into `@monica-companion/auth` or a shared utility. |
| F6 | LOW | **Step 6: `switch` refactor is minimal improvement over `if`.** | Fine for V1. Document that adding a second connector requires a connector-specific lookup function. |
| F7 | LOW | **Step 7: Boundary tests checking for `"telegram"` string may trigger false positives.** | Ensure tests only scan non-test source files and handle config defaults that legitimately reference `"telegram"` as a registry key. |
| F8 | LOW | **`InboundEvent` does not carry `connectorType`.** | Acceptable: scheduler can resolve from `user-management` using `userId`. Ensure implementation uses user-management lookup, not an assumption that ai-router provides connector routing. |

## Conclusion

The plan is well-structured, accurately identifies all Telegram-specific leaks, and proposes proportional fixes. No critical or high findings. Medium findings are implementation-guidance issues that can be addressed during implementation without changing the plan's architecture.
