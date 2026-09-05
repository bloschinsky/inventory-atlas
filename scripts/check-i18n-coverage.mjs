import { readFile } from 'node:fs/promises';

const root = new URL('../packages/i18n/src/', import.meta.url);
const [en, uk] = await Promise.all([
  readFile(new URL('locales/en.json', root), 'utf8').then(JSON.parse),
  readFile(new URL('locales/uk.json', root), 'utf8').then(JSON.parse),
]);

function keys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' ? keys(child, path) : [path];
  });
}

const missing = keys(en).filter((key) => !keys(uk).includes(key));
if (missing.length) throw new Error(`Missing Ukrainian keys: ${missing.join(', ')}`);
process.stdout.write(`i18n:check: ${keys(en).length} source keys have Ukrainian translations.\n`);
