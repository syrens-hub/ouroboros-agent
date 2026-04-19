import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

export type Locale =
  | 'en' | 'zh-CN' | 'zh-TW' | 'pt-BR' | 'de' | 'es' | 'ja' | 'ko' | 'fr' | 'tr' | 'id' | 'pl' | 'uk'

export interface SupportedLocale {
  code: Locale
  name: string
  nativeName: string
  direction: 'ltr' | 'rtl'
  flag: string
}

export const SUPPORTED_LOCALES: SupportedLocale[] = [
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
]

const translations: Record<string, Record<string, Record<string, string>>> = {
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
}

function isValidLocale(locale: string): locale is Locale {
  return SUPPORTED_LOCALES.some((l) => l.code === locale)
}

function resolveInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem('ouroboros_locale')
  if (stored && isValidLocale(stored)) return stored
  const nav = navigator.language
  if (nav && isValidLocale(nav)) return nav
  if (nav) {
    const base = nav.split('-')[0]
    const match = SUPPORTED_LOCALES.find((l) => l.code.startsWith(base + '-') || l.code === base)
    if (match) return match.code as Locale
  }
  return 'en'
}

function getNestedValue(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const dict = translations[locale] || {}
  let value = getNestedValue(dict, key)
  if (value === undefined && locale !== 'en') {
    value = getNestedValue(translations['en'], key)
  }
  if (value === undefined) return key
  if (!params) return value
  return Object.entries(params).reduce((acc, [paramKey, paramValue]) => {
    const escaped = paramKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return acc.replace(new RegExp(`\\{\\s*${escaped}\\s*\\}`, 'g'), String(paramValue))
  }, value)
}

let globalLocale = resolveInitialLocale()

interface I18nContextValue {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (locale: Locale) => void
  supportedLocales: SupportedLocale[]
}

export const I18nContext = createContext<I18nContextValue | undefined>(undefined)

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return ctx
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(globalLocale)

  useEffect(() => {
    const initial = resolveInitialLocale()
    if (initial !== locale) {
      globalLocale = initial
      setLocaleState(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setLocale = useCallback((next: Locale) => {
    if (!isValidLocale(next)) return
    globalLocale = next
    setLocaleState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ouroboros_locale', next)
    }
  }, [])

  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(locale, key, params), [locale])

  const value: I18nContextValue = {
    t,
    locale,
    setLocale,
    supportedLocales: SUPPORTED_LOCALES,
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function t(key: string, params?: Record<string, string | number>): string {
  return translate(globalLocale, key, params)
}
