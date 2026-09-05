import { access } from 'node:fs/promises';

const [, , command, requiredPath] = process.argv;
if (!command || !requiredPath) throw new Error('Expected a command name and required path.');
await access(new URL(`../${requiredPath}`, import.meta.url));
process.stdout.write(
  `${command}: foundation path is ready; implementation is owned by a later FND story.\n`,
);
