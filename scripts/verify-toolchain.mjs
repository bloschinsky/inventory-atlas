const expectedNode = '24.20.0';
const expectedPnpm = '11.25.0';
const actualNode = process.versions.node;
const userAgent = process.env.npm_config_user_agent ?? '';
const pnpmMatch = /pnpm\/([^\s]+)/u.exec(userAgent);

if (actualNode !== expectedNode) {
  throw new Error(
    `Inventory Atlas requires Node.js ${expectedNode}; received ${actualNode}. See docs/operations/development.md.`,
  );
}

if (pnpmMatch?.[1] !== expectedPnpm) {
  throw new Error(
    `Inventory Atlas requires pnpm ${expectedPnpm}; received ${pnpmMatch?.[1] ?? 'unknown'}. Use Corepack as documented.`,
  );
}
