import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.tsx'

if (typeof window !== 'undefined' && (window as unknown as { __SENTRY_DSN__?: string }).__SENTRY_DSN__) {
  Sentry.init({
    dsn: (window as unknown as { __SENTRY_DSN__: string }).__SENTRY_DSN__,
    environment: (window as unknown as { __SENTRY_ENV__?: string }).__SENTRY_ENV__ || 'production',
    tracesSampleRate: 0.1,
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 1000,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
)
