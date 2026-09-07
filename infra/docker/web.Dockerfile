# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
ARG CADDY_IMAGE=caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global corepack@0.36.0 \
    && corepack enable \
    && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/verify-toolchain.mjs scripts/verify-toolchain.mjs
COPY apps/web/package.json apps/web/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY packages/i18n packages/i18n
COPY packages/ui packages/ui
RUN pnpm --filter @inventory-atlas/web build

FROM ${CADDY_IMAGE} AS web
ARG APP_VERSION=0.1.0-dev.1
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Inventory Atlas web" \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${VCS_REF}
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist /srv
COPY --chown=10001:10001 infra/caddy/web.Caddyfile /etc/caddy/Caddyfile
USER 10001:10001
EXPOSE 8080
