# CLAUDE.md

## Scope

`AGENTS.md` is the single source of truth for the coding-agent working contract in this repository. This file exists only so that Claude Code loads that contract; it must never restate or override it.

@AGENTS.md

## Maintenance rule

Change agent rules in `AGENTS.md` only. Keep this file free of duplicated policy so the two cannot drift apart. If a rule is genuinely Claude Code specific (tool permissions, hooks, slash commands), place it under the section below and keep it non-overlapping with `AGENTS.md`.

## Claude Code specifics

- Treat `pnpm` as the only package manager; the pinned toolchain in `package.json` `engines` is enforced by `scripts/verify-toolchain.mjs` on install.
- Root scripts are the authoritative command list; read `package.json` rather than assuming a command name.
- Do not run `git push`, create branches on the remote, open or merge pull requests, or create tags. Local commits follow the Git policy in `AGENTS.md`.
