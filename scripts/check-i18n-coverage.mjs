import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const resourceRoot = new URL('../packages/i18n/src/', import.meta.url);

/** @param {unknown} value @param {string} [prefix] */
export function flattenMessages(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  return new Map(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return child && typeof child === 'object' && !Array.isArray(child)
        ? [...flattenMessages(child, path)]
        : [[path, child]];
    }),
  );
}

/** @param {{ source: unknown, target: unknown, mvpPatterns: readonly string[] }} input */
export function checkI18nCoverage({ source, target, mvpPatterns }) {
  const sourceMessages = flattenMessages(source);
  const targetMessages = flattenMessages(target);
  const errors = [];
  const stableKey = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/u;

  for (const [key, message] of sourceMessages) {
    if (!stableKey.test(key)) errors.push(`English key is not stable: ${key}`);
    if (typeof message !== 'string' || !message.trim())
      errors.push(`English message is empty: ${key}`);
  }
  for (const key of targetMessages.keys()) {
    if (!sourceMessages.has(key)) errors.push(`Ukrainian key has no English source: ${key}`);
  }

  const mvpKeys = new Set();
  for (const pattern of mvpPatterns) {
    const prefix = pattern.endsWith('.*') ? pattern.slice(0, -1) : null;
    const matches = [...sourceMessages.keys()].filter((key) =>
      prefix ? key.startsWith(prefix) : key === pattern,
    );
    if (!matches.length) errors.push(`MVP pattern has no English source key: ${pattern}`);
    for (const key of matches) mvpKeys.add(key);
  }
  for (const key of mvpKeys) {
    const translated = targetMessages.get(key);
    if (typeof translated !== 'string' || !translated.trim())
      errors.push(`Missing Ukrainian MVP key: ${key}`);
  }
  return { errors, mvpKeyCount: mvpKeys.size, sourceKeyCount: sourceMessages.size };
}

export async function checkRepositoryI18n() {
  const [source, target, manifest] = await Promise.all([
    readFile(new URL('locales/en.json', resourceRoot), 'utf8').then(JSON.parse),
    readFile(new URL('locales/uk.json', resourceRoot), 'utf8').then(JSON.parse),
    readFile(new URL('mvp.json', resourceRoot), 'utf8').then(JSON.parse),
  ]);
  if (!Array.isArray(manifest.keys)) throw new Error('MVP locale manifest must contain keys.');
  const result = checkI18nCoverage({ source, target, mvpPatterns: manifest.keys });
  if (result.errors.length) throw new Error(`i18n coverage failed:\n${result.errors.join('\n')}`);
  return result;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await checkRepositoryI18n();
  process.stdout.write(
    `i18n:check: ${result.mvpKeyCount} MVP keys have English source and Ukrainian translations.\n`,
  );
}
