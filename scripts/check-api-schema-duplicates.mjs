import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webSource = path.join(repositoryRoot, 'apps', 'web', 'src');
const extensions = new Set(['.js', '.ts', '.vue']);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if (extensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

export function duplicatePayloadViolations(file, source) {
  const violations = [];
  const declarations =
    /\b(?:interface|type|class)\s+([A-Za-z_$][\w$]*(?:Request|Response|Payload|ProblemDetails|CursorPage))\b/gu;
  for (const match of source.matchAll(declarations)) {
    violations.push(`${file}: handwritten API payload declaration ${match[1]}`);
  }
  if (
    /\b(?:z|zod)\.(?:object|strictObject)\s*\(/u.test(source) &&
    /(?:shared[\\/]api|(?:Request|Response|Payload)Schema)/u.test(file + source)
  ) {
    violations.push(`${file}: handwritten runtime API payload schema`);
  }
  return violations;
}

export async function checkDuplicatePayloadSchemas(root = webSource) {
  const violations = [];
  for (const file of await sourceFiles(root)) {
    violations.push(
      ...duplicatePayloadViolations(
        path.relative(repositoryRoot, file),
        await readFile(file, 'utf8'),
      ),
    );
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkDuplicatePayloadSchemas();
  if (violations.length) {
    throw new Error(`Handwritten duplicate API schemas are forbidden:\n${violations.join('\n')}`);
  }
  process.stdout.write('api-schema-policy: frontend payloads use generated contract schemas.\n');
}
