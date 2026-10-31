# syntax=docker/dockerfile:1
# Serva web image: the static build behind nginx, with the security headers and the web app's CSP
# (a fresh nonce per request). It is also the local server's reverse proxy: /v1 and /health go to
# the API, so every device on the shop's Wi-Fi uses one address. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t serva-web:local .

ARG NODE_IMAGE=node:22.23.3-bookworm-slim
# Runs as uid 101 and listens on 8080/8443, so it needs no root and no extra capability.
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine

# ─── Build the static app ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# pnpm at the exact version in package.json › packageManager; the store is cached with the lockfile
RUN corepack enable && pnpm fetch --frozen-lockfile && rm -rf node_modules
COPY . .
RUN pnpm install --offline --frozen-lockfile --filter "@serva/web..." \
 && pnpm --filter @serva/web build \
 && rm -f apps/web/dist/vite-manifest.json

# ─── Serve ─────────────────────────────────────────────────────────────────────────────────────
FROM ${NGINX_IMAGE} AS runtime
# Values for the config templates (the image's entrypoint fills /etc/nginx/templates/*.template)
ENV SERVA_API_UPSTREAM=api:3000 \
    SERVA_HTTPS_PORT=443 \
    NGINX_ENVSUBST_FILTER=^SERVA_
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080 8443
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
