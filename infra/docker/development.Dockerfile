# syntax=docker/dockerfile:1.7
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV COREPACK_HOME=/opt/corepack
ENV npm_config_store_dir=/pnpm/store
WORKDIR /workspace

# Only the CLI is installed: docker-tools talks to the host daemon, never DinD.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git openssl \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin docker-compose-plugin \
    && npm install --global corepack@0.36.0 \
    && corepack enable && corepack prepare pnpm@11.25.0 --activate

# Resolve dependencies and Playwright from the pinned manifests so ordinary source
# changes do not invalidate this large layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/verify-toolchain.mjs scripts/verify-toolchain.mjs
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/testkit/package.json packages/testkit/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile \
    && pnpm exec playwright install --with-deps chromium \
    && mkdir -p /media /home/node/.cache \
    && mkdir -p apps/api/node_modules apps/worker/node_modules apps/web/node_modules \
       packages/backend/node_modules packages/config/node_modules packages/contracts/node_modules \
       packages/i18n/node_modules packages/testkit/node_modules packages/ui/node_modules \
    && chown -R node:node /workspace /media /pnpm /opt/corepack /home/node/.cache \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node . .
USER node
CMD ["pnpm", "dev"]
