---
name: internet-research
description: Perform Tavily-backed research for time-sensitive or uncertain claims (APIs, limits, releases, policies, recommendations). Use when tasks require current external facts with citations.
---

# Internet Research

Use this skill when implementation choices depend on current external information.

## Core triggers
- Request includes latest/current/most recent/today.
- Task depends on external API behavior, limits, or policy rules.
- User asks for citations, links, or proof.
- Facts are uncertain and mistakes would be costly.

## Workflow
1. Define the concrete question and confidence threshold.
2. Use Tavily for search/discovery, not default websearch.
3. Use `webfetch` only for specific URLs returned by Tavily search or provided by the user.
4. Prefer official docs/release notes/repos over secondary blogs.
5. Extract claim-level evidence (dates, versions, limits, examples).
6. Separate facts from inference.
7. Return concise findings with links and residual uncertainty.

## Output format
- Findings: source-backed, ordered by confidence.
- Evidence map: `source -> claim -> confidence`.
- Repo impact: what to change locally.
- Unknowns/risks: unresolved questions.
