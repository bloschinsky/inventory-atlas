import en from './locales/en.json' with { type: 'json' };
import uk from './locales/uk.json' with { type: 'json' };

export const defaultLocale = 'en';
export const fallbackLocale = 'en';
export const messages = { en, uk };
