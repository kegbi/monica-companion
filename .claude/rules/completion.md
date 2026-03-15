# Task Completion

- A roadmap item is only marked complete (`[x]`) after full verification passes, including Docker Compose smoke tests against the live stack.
- Smoke tests must verify the actual network path (reverse proxy, middleware, port exposure) — not just in-process test helpers.
- After all unit/integration tests pass and smoke tests confirm the live behavior, update `context/product/roadmap.md` to mark the item as done.
