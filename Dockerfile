# Stage 1: Base with pnpm
FROM node:24.14.0-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Stage 2: Install deps and build
FROM base AS build
ARG SERVICE

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY services/${SERVICE}/ services/${SERVICE}/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter "@monica-companion/${SERVICE}" run build

# Stage 3: Production runtime
FROM node:24.14.0-slim AS production
ARG SERVICE
ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/services/${SERVICE}/dist ./dist
COPY --from=build /app/services/${SERVICE}/package.json ./

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod --frozen-lockfile || true

EXPOSE 3000

CMD ["node", "dist/index.js"]
