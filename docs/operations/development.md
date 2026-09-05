# Development setup

## Prerequisites

- Git.
- Node.js `24.20.0` (the exact version in `.node-version`).
- Corepack `0.36.0`.
- Docker with Compose v2 for the environment introduced in FND-02.

No globally installed pnpm, framework CLI, test runner, or formatter is required.

## Clean checkout

```bash
git clone <repository-url> inventory-atlas
cd inventory-atlas
npm install --global corepack@0.36.0
corepack enable
corepack install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

The install hook stops immediately if Node.js or pnpm differs from the pinned versions. Use a Node version manager to select the version from `.node-version` before installation.

Run `pnpm dev` to start the API and web development servers. The root commands are the supported interface; workspace-specific CLIs do not need global installation.
