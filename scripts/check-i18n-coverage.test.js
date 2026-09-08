import { describe, expect, it } from 'vitest';
import { checkI18nCoverage } from './check-i18n-coverage.mjs';

describe('i18n coverage gate', () => {
  it('detects a missing Ukrainian MVP key', () => {
    const result = checkI18nCoverage({
      source: { app: { name: 'Inventory Atlas', navigation: 'Navigation' } },
      target: { app: { name: 'Inventory Atlas' } },
      mvpPatterns: ['app.*'],
    });
    expect(result.errors).toContain('Missing Ukrainian MVP key: app.navigation');
  });

  it('rejects target-only keys and unstable names', () => {
    const result = checkI18nCoverage({
      source: { Bad_key: 'Bad' },
      target: { Bad_key: 'Погано', extra: { value: 'Зайве' } },
      mvpPatterns: ['Bad_key'],
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'English key is not stable: Bad_key',
        'Ukrainian key has no English source: extra.value',
      ]),
    );
  });
});
