export type Locale =
  | 'en'
  | 'zh-CN'
  | 'zh-TW'
  | 'pt-BR'
  | 'de'
  | 'es'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'tr'
  | 'id'
  | 'pl'
  | 'uk';

export interface LocaleInfo {
  code: Locale;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
  flag: string;
}

export const SUPPORTED_LOCALES: LocaleInfo[] = [
  { code: 'en', name: 'English', nativeName: 'English', direction: 'ltr', flag: '\uD83C\uDDFA\uD83C\uDDF8' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', nativeName: '\u7B80\u4F53\u4E2D\u6587', direction: 'ltr', flag: '\uD83C\uDDE8\uD83C\uDDF3' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', nativeName: '\u7E41\u9AD4\u4E2D\u6587', direction: 'ltr', flag: '\uD83C\uDDF9\uD83C\uDDFC' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Portugu\u00EAs (Brasil)', direction: 'ltr', flag: '\uD83C\uDDE7\uD83C\uDDF7' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', direction: 'ltr', flag: '\uD83C\uDDE9\uD83C\uDDEA' },
  { code: 'es', name: 'Spanish', nativeName: 'Espa\u00F1ol', direction: 'ltr', flag: '\uD83C\uDDEA\uD83C\uDDF8' },
  { code: 'ja', name: 'Japanese', nativeName: '\u65E5\u672C\u8A9E', direction: 'ltr', flag: '\uD83C\uDDEF\uD83C\uDDF5' },
  { code: 'ko', name: 'Korean', nativeName: '\uD55C\uAD6D\uC5B4', direction: 'ltr', flag: '\uD83C\uDDF0\uD83C\uDDF7' },
  { code: 'fr', name: 'French', nativeName: 'Fran\u00E7ais', direction: 'ltr', flag: '\uD83C\uDDEB\uD83C\uDDF7' },
  { code: 'tr', name: 'Turkish', nativeName: 'T\u00FCrk\u00E7e', direction: 'ltr', flag: '\uD83C\uDDF9\uD83C\uDDF7' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr', flag: '\uD83C\uDDEE\uD83C\uDDE9' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', direction: 'ltr', flag: '\uD83C\uDDF5\uD83C\uDDF1' },
  { code: 'uk', name: 'Ukrainian', nativeName: '\u0423\u043A\u0440\u0430\u0457\u043D\u0441\u044C\u043A\u0430', direction: 'ltr', flag: '\uD83C\uDDFA\uD83C\uDDE6' },
];

export type TranslationDictionary = Record<string, unknown>;

const translations: Record<Locale, TranslationDictionary> = {
  en: {
    common: {
      appName: 'Ouroboros',
      loading: 'Loading...',
      error: 'An error occurred',
      save: 'Save',
      cancel: 'Cancel',
    },
    chat: {
      send: 'Send',
      placeholder: 'Type a message...',
    },
    settings: {
      title: 'Settings',
    },
    dashboard: {
      title: 'Dashboard',
    },
  },
  'zh-CN': {
    common: {
      appName: 'Ouroboros',
      loading: '\u52A0\u8F7D\u4E2D...',
      error: '\u53D1\u751F\u9519\u8BEF',
      save: '\u4FDD\u5B58',
      cancel: '\u53D6\u6D88',
    },
    chat: {
      send: '\u53D1\u9001',
      placeholder: '\u8F93\u5165\u6D88\u606F...',
    },
    settings: {
      title: '\u8BBE\u7F6E',
    },
    dashboard: {
      title: '\u4EEA\u8868\u677F',
    },
  },
  'zh-TW': {},
  'pt-BR': {},
  de: {},
  es: {},
  ja: {},
  ko: {},
  fr: {},
  tr: {},
  id: {},
  pl: {},
  uk: {},
};

function isValidLocale(locale: string): locale is Locale {
  return SUPPORTED_LOCALES.some((l) => l.code === locale);
}

function getNestedValue(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export interface I18nConfig {
  defaultLocale?: Locale;
  fallbackLocale?: Locale;
  persistLocale?: boolean;
}

export class I18n {
  private currentLocale: Locale;
  private fallbackLocale: Locale;
  private persistLocale: boolean;

  constructor(config: I18nConfig = {}) {
    this.currentLocale = config.defaultLocale && isValidLocale(config.defaultLocale)
      ? config.defaultLocale
      : 'en';
    this.fallbackLocale = config.fallbackLocale && isValidLocale(config.fallbackLocale)
      ? config.fallbackLocale
      : 'en';
    this.persistLocale = config.persistLocale ?? false;
  }

  setLocale(locale: Locale): void {
    if (!isValidLocale(locale)) {
      throw new Error(`Unsupported locale: ${locale}`);
    }
    this.currentLocale = locale;
    if (this.persistLocale) {
      // Intentionally no-op for backend; persistence is handled by caller.
    }
  }

  getLocale(): Locale {
    return this.currentLocale;
  }

  getLocaleInfo(): LocaleInfo {
    const info = SUPPORTED_LOCALES.find((l) => l.code === this.currentLocale);
    if (!info) {
      throw new Error(`Locale info not found for: ${this.currentLocale}`);
    }
    return info;
  }

  getSupportedLocales(): LocaleInfo[] {
    return SUPPORTED_LOCALES.slice();
  }

  t(key: string, params?: Record<string, string | number>): string {
    let value = getNestedValue(translations[this.currentLocale] as Record<string, unknown>, key);
    if (value === undefined && this.currentLocale !== this.fallbackLocale) {
      value = getNestedValue(translations[this.fallbackLocale] as Record<string, unknown>, key);
    }
    if (value === undefined) {
      return key;
    }
    if (!params) {
      return value;
    }
    return Object.entries(params).reduce((acc, [paramKey, paramValue]) => {
      return acc.replace(new RegExp(`\\{\\s*${escapeRegExp(paramKey)}\\s*\\}`, 'g'), String(paramValue));
    }, value);
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.currentLocale, options).format(value);
  }

  formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(this.currentLocale, options).format(date);
  }

  formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ): string {
    return new Intl.RelativeTimeFormat(this.currentLocale, options).format(value, unit);
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let globalI18n: I18n | undefined;

export function createI18n(config?: I18nConfig): I18n {
  globalI18n = new I18n(config);
  return globalI18n;
}

export function getI18n(): I18n {
  if (!globalI18n) {
    globalI18n = new I18n();
  }
  return globalI18n;
}

export function t(key: string, params?: Record<string, string | number>): string {
  return getI18n().t(key, params);
}
