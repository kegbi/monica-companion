# Documentation Review: Monica Companion

Date: 2026-03-15

Scope reviewed:
- `AGENTS.md`
- `context/product/product-definition.md`
- `context/product/product-definition-lite.md`
- `context/product/roadmap.md`
- `context/product/architecture.md`
- `context/product/service-architecture.md`
- `context/product/acceptance-criteria.md`
- `context/product/monica-api-scope.md`
- `.claude/rules/workflow.md`
- `.claude/rules/testing.md`
- `.claude/rules/service-boundaries.md`
- `.claude/rules/security.md`
- `.claude/rules/reliability.md`
- `.claude/rules/definition-of-done.md`
- `.claude/rules/code-style.md`

Method:
- Reviewed all docs referenced by `AGENTS.md`.
- Cross-checked product scope, roadmap, acceptance criteria, architecture, service boundaries, and engineering rules for contradictions.
- Focused on security, boundary quality, SOLID implications, architecture risks, missing implementation detail, and likely overengineering.

## Executive Assessment

The documentation is directionally strong. It shows clear intent around modularity, security, observability, and future connector support. The main problem is not lack of ambition; it is that several core contracts are still underspecified while the architecture already assumes a very decomposed system. That combination creates risk: the team can spend significant time building infrastructure around boundaries that are not yet stable.

The most important issues are:
- The public/internal exposure model is contradictory and currently weak from a security standpoint.
- User-supplied Monica base URLs create an SSRF/egress risk that is not addressed anywhere.
- The onboarding setup-link model is underspecified for authentication and replay safety.
- The Monica API contract document is still a placeholder even though multiple docs depend on it as a source of truth.
- The confirmation/disambiguation lifecycle is not specified well enough to safely execute mutations.

## Findings

### High Severity

#### H1. Public versus internal service exposure is contradictory

Evidence:
- `context/product/architecture.md:32-34` says services communicate over an internal Docker network only, but also says Caddy routes to "internal service APIs".
- `context/product/service-architecture.md:190` says Caddy routes to service health endpoints.
- `context/product/service-architecture.md:254-258` says only `telegram-bridge` and `web-ui` are exposed externally.
- `.claude/rules/security.md:3-5` says internal endpoints must be authenticated and closed to anonymous traffic.

Why this matters:
- If Caddy really fronts internal APIs or health endpoints publicly, the documented caller-allowlist model is weakened immediately.
- Public health endpoints also increase reconnaissance surface.
- This is not just doc drift. It changes the security posture of the whole system.

Recommendation:
- Define an explicit ingress matrix.
- Public routes should be limited to the Telegram webhook endpoint and the onboarding UI.
- Keep internal APIs and `/health` endpoints private to the internal network unless a specific admin endpoint is intentionally exposed and authenticated.
- Document Telegram webhook authenticity checks, rate limiting, and request size limits as part of the same ingress model.

#### H2. User-provided MonicaHQ base URLs create an SSRF and egress-control gap

Evidence:
- `context/product/product-definition.md:16`, `:47-48`, `:68`
- `context/product/roadmap.md:38`
- `context/product/architecture.md:42`
- `context/product/service-architecture.md:83-84`, `:144`

Why this matters:
- The system will issue authenticated outbound requests to a URL provided by the user.
- Without explicit validation and egress policy, an attacker can target internal services, link-local addresses, or metadata endpoints.
- JWT auth and caller allowlists do not mitigate this class of risk because the attack travels through the Monica integration path.

Recommendation:
- Require HTTPS by default.
- Reject loopback, RFC1918, link-local, and other non-public destination ranges after DNS resolution.
- Reject redirects to blocked networks.
- Normalize and persist a canonical base URL.
- Consider an outbound allowlist or proxy if the deployment model is centrally hosted.
- Add this as an explicit security acceptance criterion, not just an implementation note.

#### H3. The onboarding "unique setup link" is not specified as a secure authentication flow

Evidence:
- `context/product/product-definition.md:48`, `:53`
- `context/product/roadmap.md:47-49`
- `context/product/architecture.md:46`
- `context/product/service-architecture.md:163-165`

Why this matters:
- A setup link is effectively an authentication artifact.
- The docs do not define expiration, one-time use, replay behavior, CSRF handling, or how the link is bound to a Telegram user/chat identity.
- Without those details, account linking and credential submission are exposed to takeover or accidental cross-account binding.

Recommendation:
- Treat the setup link as a short-lived, one-time, signed token.
- Bind it to the Telegram user ID and intended onboarding step.
- Define TTL, consume-on-use behavior, re-issue flow, cancellation flow, and audit logging.
- Add CSRF/origin protections for the onboarding form submission path.

#### H4. `monica-api-scope.md` is still a placeholder, but the rest of the system already depends on it as authoritative

Evidence:
- `context/product/monica-api-scope.md:3`, `:36`
- `context/product/roadmap.md:36-39`
- `context/product/architecture.md:42`, `:67`
- `.claude/rules/testing.md:9-11`

Why this matters:
- Typed clients, fixtures, integration tests, validation schemas, and AI-facing command contracts all depend on precise Monica endpoint behavior.
- The current document does not define endpoint paths, auth behavior, error shapes, pagination, field mappings, or example payloads.
- This blocks accurate implementation and makes test fixtures speculative.

Recommendation:
- Complete this document before implementation proceeds beyond scaffolding.
- Add endpoint paths, required headers, request/response schemas, pagination semantics, expected error shapes, and fixture examples.
- Include every operation required by the product experience, not just a loose endpoint list.

#### H5. The command confirmation and pending-action lifecycle is under-specified

Evidence:
- `context/product/product-definition.md:43-45`, `:55-57`
- `context/product/roadmap.md:63-68`
- `context/product/service-architecture.md:42-46`, `:100-107`

Why this matters:
- The product depends on confirmations, edits, disambiguation, and follow-up voice/text replies.
- None of the docs define how a pending action is stored, correlated, expired, edited, or rejected as stale.
- This is a correctness and safety gap. "Yes" or "cancel" is meaningless unless it is bound to an exact pending proposal and version.

Recommendation:
- Document a full command lifecycle: `draft -> pending_confirmation -> confirmed -> executed -> expired/cancelled`.
- Include correlation IDs, optimistic version checks, TTL rules, and stale-confirmation rejection behavior.
- Define how voice confirmations and text clarifications attach to an existing pending command.

#### H6. `user-management` is over-privileged and violates least-privilege boundaries

Evidence:
- `context/product/service-architecture.md:138-150`
- `.claude/rules/service-boundaries.md:10`

Why this matters:
- The docs make `user-management` the source of truth for credentials and configuration, then allow `web-ui`, `telegram-bridge`, `scheduler`, `monica-integration`, and `ai-router` to call it.
- That makes one service both a security boundary and a broad dependency for much of the system.
- This is a security problem and a SOLID problem: it weakens SRP and interface segregation, and it expands the blast radius of a compromise.

Recommendation:
- Split access by responsibility, even if it stays in one deployable for V1.
- `ai-router` should never need direct credential access.
- `scheduler` should read schedules and command metadata, not Monica secrets.
- Only `monica-integration` should obtain decrypted Monica credentials, preferably through a narrow port with audited access.

### Medium Severity

#### M1. Retry ownership is duplicated across layers and will amplify failures

Evidence:
- `context/product/roadmap.md:37`, `:78`
- `context/product/service-architecture.md:81-82`, `:102`
- `.claude/rules/reliability.md:4`

Why this matters:
- `monica-integration` retries transient Monica failures, and `scheduler` retries failed commands.
- Without explicit retry budgets and ownership rules, a single outage can trigger multiplicative retries and slow recovery.

Recommendation:
- Decide which layer owns which retry class.
- Example: transport-level quick retries in `monica-integration`, business/job retries in `scheduler`, with strict caps and observability tags.
- Document backoff ceilings and circuit-breaker behavior.

#### M2. The "connector-agnostic" transcription API is not actually connector-agnostic yet

Evidence:
- `context/product/service-architecture.md:25`, `:58-62`
- `context/product/roadmap.md:94-96`
- `.claude/rules/service-boundaries.md:9`

Why this matters:
- "Audio file reference" is a connector-shaped abstraction.
- Telegram file identifiers are not a useful long-term contract for Matrix, Discord, or future web uploads.
- This leaks outer-layer assumptions into a supposedly reusable service interface.

Recommendation:
- Define a connector-neutral audio ingestion contract now.
- Good options are raw binary upload, a temporary object-store URL, or a presigned fetch URL plus media metadata.
- Keep Telegram file retrieval inside `telegram-bridge`.

#### M3. Contact resolution requirements exceed the documented Monica data contract

Evidence:
- `context/product/product-definition.md:43`, `:55`, `:58`
- `context/product/monica-api-scope.md:7-32`
- `.claude/rules/service-boundaries.md:4`

Why this matters:
- The product claims support for references like "Mom", "my brother", and "Uncle Jorge".
- The Monica API scope does not define relationship data, nickname fields, alias strategy, or the canonical internal contact summary exposed to `ai-router`.
- This makes the current contact-resolution story incomplete and risks leaking Monica-specific schemas into AI logic.

Recommendation:
- Define the internal contact projection that `ai-router` consumes.
- Add every Monica endpoint or data field required for kinship, nickname, and birthday-based lookup.
- State what minimum data the AI receives versus what remains in deterministic code paths.

#### M4. Success metrics and acceptance criteria are not measurable as written

Evidence:
- `context/product/product-definition.md:32-34`
- `context/product/acceptance-criteria.md:11-12`

Why this matters:
- "90% correct" is not a test plan.
- The docs do not define evaluation corpus, sample size, scoring method, confidence threshold, or whether writes and reads are measured separately.
- This will create disputes later about whether the product is "good enough" to ship.

Recommendation:
- Define a benchmark dataset and a repeatable evaluation process.
- Separate metrics for read-only queries, write intents, contact resolution, and transcription quality.
- Add latency SLOs and acceptable false-positive rates for mutating commands.

#### M5. Reminder scheduling is missing timezone, DST, and misfire semantics

Evidence:
- `context/product/product-definition.md:46`, `:53`, `:59`, `:77`
- `context/product/acceptance-criteria.md:26-30`
- `context/product/service-architecture.md:104-105`, `:145`

Why this matters:
- "8am" is meaningless without a timezone.
- DST transitions and downtime recovery can cause duplicate or missed reminders if schedule windows are not defined precisely.

Recommendation:
- Store an IANA timezone per user.
- Define DST behavior, downtime catch-up rules, and how the dedupe key for a "schedule window" is computed.
- Make timezone selection explicit during onboarding.

#### M6. A shared OpenAI API key with no per-user controls is a cost and availability risk

Evidence:
- `context/product/product-definition.md:79`, `:109`
- `context/product/architecture.md:11`

Why this matters:
- One abusive or buggy user can degrade the service for everyone.
- Observability alone is not a control.

Recommendation:
- Even if BYOK is deferred, add minimum guardrails in V1: per-user quotas, concurrency caps, request size limits, budget alarms, and operator kill switches.
- Document what happens when OpenAI budget or quota is exhausted.

#### M7. Data governance is too narrow; only log redaction is specified

Evidence:
- `context/product/architecture.md:21`, `:52-59`
- `context/product/service-architecture.md:107`, `:128`, `:188`
- `.claude/rules/security.md:7`, `:12`

Why this matters:
- This system handles sensitive relationship data, voice transcripts, conversation history, and reminders.
- The docs discuss log redaction, but not retention, deletion, trace attributes, queue payload storage, or audit record minimization.

Recommendation:
- Add retention and deletion policy for conversation history, command logs, delivery audits, and traces.
- Clarify what exact message content is stored versus what is summarized.
- Ensure the same redaction/minimization policy applies to traces, dead letters, and support tooling, not just logs.

#### M8. The testing strategy is ambiguous about real Monica integration tests

Evidence:
- `context/product/roadmap.md:39`
- `context/product/architecture.md:67`
- `.claude/rules/testing.md:9-10`

Why this matters:
- One set of docs asks for real-account integration testing.
- Another forbids real Monica calls in automated tests and CI.
- Both positions can coexist, but only if the docs explicitly separate CI, nightly, manual, or release-gate suites.

Recommendation:
- Split the test strategy into:
- Mocked contract tests in CI.
- Controlled real-Monica smoke tests outside CI or in a gated environment.
- A documented release gate that states when real-Monica verification is required.

#### M9. The outbound delivery boundary is inconsistent across the docs

Evidence:
- `context/product/roadmap.md:83-84`
- `.claude/rules/service-boundaries.md:6`
- `context/product/service-architecture.md:122-126`, `:244-249`, `:257`

Why this matters:
- One place says `delivery` receives formatted results.
- Another says the connector owns formatting.
- The service diagram also shows `delivery` talking straight to Telegram/future connectors, bypassing `telegram-bridge`.

Recommendation:
- Pick one model and use it consistently.
- The cleaner model is: scheduler emits connector-neutral message intents, `delivery` routes only, connector formats and sends.
- Update the diagram and wording to match that model exactly.

#### M10. The roadmap is partially stale relative to the chosen architecture

Evidence:
- `context/product/roadmap.md:13-14`
- `context/product/architecture.md:7-15`, `:65-69`
- `.claude/rules/code-style.md:3-14`

Why this matters:
- The roadmap still frames technology and test framework choice as pending, while other docs have already fixed TypeScript, pnpm, Vitest, Biome, BullMQ, LangGraph, and OpenTelemetry.
- That makes the roadmap less useful as a sequencing tool.

Recommendation:
- Rewrite roadmap items so they track unresolved decisions and delivery slices, not already-made choices.
- This should become an execution plan, not a restatement of earlier architecture decisions.

### Low Severity

#### L1. Application container counts are inconsistent and currently wrong

Evidence:
- `context/product/product-definition.md:96`
- `context/product/product-definition-lite.md:21`
- `context/product/architecture.md:9`
- `context/product/service-architecture.md:3`

Why this matters:
- Several docs claim 9 application containers and 17 total containers.
- The named application services are `telegram-bridge`, `ai-router`, `voice-transcription`, `monica-integration`, `scheduler`, `delivery`, `user-management`, and `web-ui`, which is 8 application services.
- With 3 infrastructure and 5 observability services, the current total is 16, not 17.

Recommendation:
- Correct the counts everywhere, or add the missing ninth application service if one is actually intended.

#### L2. "Basic CRUD" is misleading because delete behavior is mostly not in scope

Evidence:
- `context/product/product-definition.md:44`, `:74`
- `context/product/acceptance-criteria.md:14`
- `context/product/monica-api-scope.md:25-27`

Why this matters:
- The product text says CRUD, but the accepted behaviors are create, update, and query focused.
- The only explicit delete operation in the API scope is note deletion.

Recommendation:
- Either define deletion flows clearly, or rename this to "basic create/update/query operations" to avoid misleading implementation expectations.

## SOLID and Architecture Themes

The current documentation has a strong instinct for separation of concerns, but several boundaries are still not clean enough to support the decomposition being proposed.

Main SOLID concerns:
- SRP: `user-management` currently owns account data, configuration, Telegram linkage, and effective credential distribution to multiple downstream services.
- ISP: the same `user-management` interface appears to serve very different consumers with very different privilege needs.
- DIP: the transcription contract leaks connector-specific "file reference" assumptions into a service that is supposed to be connector-agnostic.
- Boundary purity: the Monica anti-corruption layer is not fully defined for `ai-router`, and the delivery/formatting boundary is inconsistent.

What this means in practice:
- The architecture is trying to be hexagonal/service-oriented, but some core ports are still undefined.
- Until those ports are explicit, the service split will create coupling by accident instead of reducing it.

## Overengineering Notes

These are not all defects, but they are serious delivery risks for a V1 product.

- The system is already documented as 8 application services plus full observability infrastructure before the Monica API contract and command lifecycle are fully specified. That is a lot of operational surface area to carry before the core user loop is proven.
- Routing every interactive command through BullMQ and a dedicated scheduler gives consistency, but it also adds latency, queue dependence, and another failure mode for simple read-only lookups.
- A separate delivery service and a separate voice-transcription service may be justified later, but for a Telegram-only first release they should be defended with concrete operational reasons, not only future extensibility.
- LangGraph may be appropriate for multi-turn flows, but the docs do not yet justify why a simpler intent parser plus explicit state machine would be insufficient for V1.
- The observability stack is comprehensive, which is good, but Phase 1 currently risks prioritizing platform complexity before proving end-user value.

Suggested framing:
- Start with the minimum architecture that still preserves hard security boundaries.
- Promote modules to services only when there is a real scaling, ownership, isolation, or connector-reuse reason.
- Keep "future connector support" as a contract-design concern first, not necessarily a deployment-topology decision on day one.

## Positive Notes

The docs also do several things well:
- Security, reliability, and observability are treated as first-class concerns instead of afterthoughts.
- The service-boundary rules are directionally sound and worth preserving.
- The product scope is clear about non-goals and avoids trying to replicate all Monica features in V1.
- The docs correctly recognize the need for idempotency, delivery auditing, and explicit failure handling.

## Recommended Repair Order

1. Resolve the security model first.
   - Fix public versus internal exposure rules.
   - Specify setup-link authentication and replay controls.
   - Add SSRF and egress protections for user-provided Monica URLs.

2. Finish the missing core contracts.
   - Complete `monica-api-scope.md`.
   - Define the command lifecycle and confirmation model.
   - Define the internal contact projection consumed by `ai-router`.

3. Tighten boundary design.
   - Reduce `user-management` privilege surface.
   - Clarify delivery formatting ownership.
   - Define a connector-neutral audio ingestion contract.

4. Rebaseline execution realism.
   - Add measurable acceptance metrics.
   - Specify timezone and scheduling rules.
   - Clarify real-Monica testing policy.
   - Revisit whether the V1 service split is justified or premature.
