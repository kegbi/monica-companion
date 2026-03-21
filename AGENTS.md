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
| Monica v4.1.1 reference source code | `references/remote/app/` (gitignored) |
| Monica Docker image (entrypoint, Dockerfile) | `references/remote/docker/` (gitignored) |
| V1 deployment profile ADR | `context/product/adr-v1-deployment-profile.md` |
| Testing strategy and release gates | `context/product/testing-strategy.md` |
| V1 release readiness report | `context/product/v1-release-readiness-report.md` |
| Data governance spec | `context/spec/data-governance.md` |
| Connector extension guide | `context/spec/connector-extension-guide.md` |
| Operational review findings | `context/spec/operational-review-findings.md` |
| Secret rotation policy | `docs/secret-rotation.md` |
| Engineering rules and coding standards | `.claude/rules/` |

## Reference Source Code

The `references/remote/` directory contains gitignored reference repos for contract verification:

- **`references/remote/app/`** — Monica v4.1.1 application source
- **`references/remote/docker/`** — Monica Docker image definitions (entrypoint, Dockerfiles)

### App source key paths

| Concern | Path |
|---|---|
| API response shapes (Resource classes) | `references/remote/app/app/Http/Resources/` |
| Service validation rules | `references/remote/app/app/Services/` |
| API controllers | `references/remote/app/app/Http/Controllers/Api/` |
| Eloquent models | `references/remote/app/app/Models/` |
| API route definitions | `references/remote/app/routes/api.php` |

### Docker image key paths

| Concern | Path |
|---|---|
| v4 Apache entrypoint | `references/remote/docker/4/apache/entrypoint.sh` |
| v4 Apache Dockerfile | `references/remote/docker/4/apache/Dockerfile` |

### Re-download

```sh
# App source (v4.1.1)
mkdir -p references/remote/app
curl -sL "https://github.com/monicahq/monica/archive/refs/tags/v4.1.1.tar.gz" | tar xz --strip-components=1 -C references/remote/app/

# Docker image definitions
mkdir -p references/remote/docker
curl -sL "https://github.com/monicahq/docker/archive/refs/heads/main.tar.gz" | tar xz --strip-components=1 -C references/remote/docker/
```
