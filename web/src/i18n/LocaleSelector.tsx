import type { SelectHTMLAttributes } from 'react'
import { useI18n } from './index.tsx'

export function LocaleSelector(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { locale, setLocale, supportedLocales } = useI18n()

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as typeof supportedLocales[number]['code'])}
      {...props}
    >
      {supportedLocales.map((l) => (
        <option key={l.code} value={l.code}>
          {l.flag} {l.nativeName}
        </option>
      ))}
    </select>
  )
}
