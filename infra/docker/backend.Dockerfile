# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

FROM ${NODE_IMAGE} AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /workspace
RUN npm install --global corepack@0.36.0 \
    && corepack enable \
    && corepack prepare pnpm@11.25.0 --activate

FROM toolchain AS dependencies
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
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm --filter @inventory-atlas/backend build \
    && pnpm --filter @inventory-atlas/config build \
    && pnpm --filter @inventory-atlas/api build \
    && pnpm --filter @inventory-atlas/worker build

FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=0.1.0-dev.1
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Inventory Atlas backend" \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${VCS_REF}
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /workspace/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=node:node /workspace/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=node:node /workspace/packages/backend/package.json ./packages/backend/package.json
COPY --from=build --chown=node:node /workspace/packages/backend/dist ./packages/backend/dist
COPY --from=build --chown=node:node /workspace/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=build --chown=node:node /workspace/packages/config/package.json ./packages/config/package.json
COPY --from=build --chown=node:node /workspace/packages/config/dist ./packages/config/dist
COPY --from=build --chown=node:node /workspace/scripts ./scripts
COPY --from=build --chown=node:node /workspace/db ./db
RUN install --directory --owner=node --group=node /var/lib/inventory-atlas/media
USER node
EXPOSE 3000

FROM runtime AS api
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime AS migrate
CMD ["node", "packages/backend/dist/migrate.js"]
