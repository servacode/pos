# syntax=docker/dockerfile:1
# Serva API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t serva-api:local .
# The same image runs the API (default command) and the one-shot migrate + seed job
# (deploy/local/compose.yml › migrate).

ARG NODE_IMAGE=node:22.23.3-bookworm-slim

# ─── pnpm and every package in the lockfile (cached while the lockfile does not change) ────────
FROM ${NODE_IMAGE} AS pnpm
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# pnpm at the exact version in package.json › packageManager. `fetch` fills the store and also a
# virtual store holding every package; that one is dropped so each stage installs only its own.
RUN corepack enable && pnpm fetch --frozen-lockfile && rm -rf node_modules

# ─── Build: bundle the API (workspace packages are bundled into dist by tsup) ─────────────────
FROM pnpm AS build
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@serva/api..." \
 && pnpm --filter @serva/api build

# ─── Runtime dependencies only, exactly as locked ────────────────────────────────────────────
FROM pnpm AS prod-deps
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --offline --frozen-lockfile --prod --filter "@serva/api..."

# ─── Runtime: no build tools, no sources, not root ──────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    MIGRATIONS_DIR=/app/drizzle
# Same layout as the workspace: apps/api/node_modules links into the root virtual store.
WORKDIR /app/apps/api
# Files stay owned by root, so the running process cannot change its own code.
COPY --from=prod-deps /repo/node_modules /app/node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/drizzle /app/drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
