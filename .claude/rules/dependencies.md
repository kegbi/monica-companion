# Dependency Version Rules

- Before installing any npm package or specifying a Docker image tag, verify the latest stable version via web search or the official registry.
- Never guess or assume version numbers — always confirm against the source of truth (npmjs.com, Docker Hub, GitHub releases).
- Pin exact versions in package.json (no `^` or `~` ranges) for reproducible builds.
- Pin exact image tags in Docker Compose and Dockerfiles — never use `latest`.
- When updating dependencies, verify compatibility with the project's Node.js version and other dependencies.
- Before using or updating any Docker image, verify the latest stable tag AND check for known CVEs or security advisories. Prefer images with no critical/high vulnerabilities. Check Docker Hub, GitHub security advisories, and official release notes.
- For Node.js base images, always use the current LTS line. Check the Node.js release schedule and pick the latest patch with no outstanding security advisories.
