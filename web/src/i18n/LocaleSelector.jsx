import { useI18n } from './index.jsx'

export function LocaleSelector(props) {
  const { locale, setLocale, supportedLocales } = useI18n()

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
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
