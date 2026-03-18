---
verdict: FAIL
services_tested: []
checks_run: 0
checks_passed: 0
---

# Smoke Test Report: LangGraph Pipeline Foundation

## Environment
- Services started: none
- Health check status: N/A -- services could not be started
- Stack startup time: N/A

## Infrastructure Failure: Docker Image Pull Blocked

The smoke test could not proceed because Docker image pulls are blocked by the egress proxy in this environment.

**Root cause:** The environment routes all traffic through an egress proxy (`HTTP_PROXY`/`HTTPS_PROXY` at `21.0.0.161:15004`) that enforces a domain allowlist. While `registry-1.docker.io`, `auth.docker.io`, and `production.cloudflare.docker.com` are in the allowlist, the Docker image blob storage domain (`docker-images-prod.*.r2.cloudflarestorage.com`) is NOT in the allowlist.

**Sequence of events:**
1. Docker daemon was initially unable to resolve DNS for `registry-1.docker.io` (daemon had no proxy configured)
2. Docker daemon was restarted with proxy environment variables -- DNS resolution then worked
3. Docker can authenticate with the registry and fetch manifests
4. Docker FAILS to download image blobs because the R2 CDN domain is blocked by the proxy: `Forbidden`

**Error from `docker pull postgres:17.9-alpine`:**
```
failed to copy: httpReadSeeker: failed open: failed to do request:
Get "https://docker-images-prod.6aa30f8b08e16409b46e0173d6de2f56.r2.cloudflarestorage.com/...": Forbidden
```

**Error from `docker pull node:24.14.0-slim`:**
```
failed to copy: httpReadSeeker: failed open: failed to do request:
Get "https://docker-images-prod.6aa30f8b08e16409b46e0173d6de2f56.r2.cloudflarestorage.com/...": Forbidden
```

No Docker images are available locally (`docker images` returned empty).

## Checks

| # | Check | Expected | Actual | Result |
|---|-------|----------|--------|--------|
| 1 | Docker images pull | Images available | Blocked by egress proxy | FAIL |
| 2 | postgres + redis start | Healthy | Not attempted | SKIP |
| 3 | ai-router start | Healthy | Not attempted | SKIP |
| 4 | GET /health | 200 `{"status":"ok","service":"ai-router"}` | Not attempted | SKIP |
| 5 | POST /internal/process without auth | 401 | Not attempted | SKIP |
| 6 | conversation_turns table exists | Table present | Not attempted | SKIP |
| 7 | ai-router not exposed via Caddy | 404 from Caddy | Not attempted | SKIP |

## Failures

### FAIL: Docker Image Pull Blocked by Egress Proxy

All Docker image pulls fail because the Cloudflare R2 blob storage domain used by Docker Hub (`docker-images-prod.*.r2.cloudflarestorage.com`) is not in the egress proxy's allowed hosts list. This is an environment limitation, not a code issue.

**To resolve:** Either:
1. Add `*.r2.cloudflarestorage.com` to the egress proxy allowlist
2. Pre-load Docker images into the environment before running smoke tests
3. Use a Docker registry mirror accessible from within the network

## Teardown

No services were started, so no teardown was needed. The Docker daemon was restarted with proxy configuration during diagnosis.

## Verdict Rationale

FAIL due to infrastructure limitation: the egress proxy blocks Docker image blob downloads, preventing any Docker containers from being started. This is NOT a code defect in the LangGraph Pipeline Foundation implementation. The implementation code (graph state, echo node, route restructuring, conversation_turns migration) was verified through unit tests (134 tests passed per the implementation summary). The smoke test should be re-run in an environment where Docker image pulls are not blocked.
