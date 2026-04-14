import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LearningInsights } from './LearningInsights.jsx'

const mockFetch = vi.fn()

vi.mock('../api.js', () => ({
  apiFetch: (...args) => mockFetch(...args),
}))

function Wrapper({ children }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('LearningInsights', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('renders patterns and config', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: [
          { sequence: 'A -> B', successRate: 0.95 },
          { sequence: 'B -> C', successRate: 0.88 },
          { sequence: 'C -> D', successRate: 0.72 },
        ],
      }),
    })
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: {
          temperature: 0.7,
          maxTokens: 2048,
          pruningStrategy: 'entropy',
          contextBudget: 4096,
        },
      }),
    })

    render(<LearningInsights sessionId="demo-session" />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('A -> B')).toBeInTheDocument()
      expect(screen.getByText('B -> C')).toBeInTheDocument()
      expect(screen.getByText('C -> D')).toBeInTheDocument()
      expect(screen.getByText('95%')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('0.7')).toBeInTheDocument()
      expect(screen.getByText('2048')).toBeInTheDocument()
      expect(screen.getByText('entropy')).toBeInTheDocument()
      expect(screen.getByText('4096')).toBeInTheDocument()
    })
  })

  it('uses hardcoded sessionId in API path', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: {} }) })

    render(<LearningInsights sessionId="demo-session" />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/learning/config/demo-session')
    })
  })
})
