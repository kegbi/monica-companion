# AGENTS.md

These documents describe the planned Monica Companion target state unless a document explicitly calls out current repository state or already-implemented behavior.

## Where to Find What

| What | Where |
|---|---|
| Product scope, features, boundaries | `context/product/product-definition.md` |
| Product summary (one-pager) | `context/product/product-definition-lite.md` |
| Implementation phases and priorities | `context/product/roadmap.md` |
| Target tech stack, infrastructure, tooling, deployment profile | `context/product/architecture.md` |
| Service descriptions, responsibilities, communication flow | `context/product/service-architecture.md` |
| V1 acceptance criteria | `context/product/acceptance-criteria.md` |
| Monica v4 API endpoints and contracts | `context/product/monica-api-scope.md` |
| Monica v4.1.1 reference source code | `references/remote/` (gitignored) |
| V1 deployment profile ADR | `context/spec/adr-v1-deployment-profile.md` |
| Engineering rules and coding standards | `.claude/rules/` |

## Reference Source Code

The Monica v4.1.1 source code is downloaded at `references/remote/` for typechecking and contract verification. Key paths:

| Concern | Path |
|---|---|
| API response shapes (Resource classes) | `references/remote/app/Http/Resources/` |
| Service validation rules | `references/remote/app/Services/` |
| API controllers | `references/remote/app/Http/Controllers/Api/` |
| Eloquent models | `references/remote/app/Models/` |
| API route definitions | `references/remote/routes/api.php` |

This directory is gitignored. Re-download with:
```sh
curl -sL "https://github.com/monicahq/monica/archive/refs/tags/v4.1.1.tar.gz" | tar xz --strip-components=1 -C references/remote/
```
