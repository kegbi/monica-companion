# Definition of Done

All changes must satisfy these criteria before being considered complete:

1. Changes align with product definition scope and architecture boundaries defined in `context/product/`.
2. Security, reliability, and observability constraints remain explicit and are not weakened.
3. No unresolved high or medium review findings.
4. TDD sequence is preserved for behavior changes: failing test observed first, then minimal implementation.
5. Relevant tests and checks pass, or gaps are explicitly documented with rationale.
6. Delivery summary includes changed files and residual risks.
7. Strict payload validation (Zod schemas) is enforced on all new inbound/outbound contracts.
8. Sensitive data is never logged — redaction is applied via the shared redaction package.
