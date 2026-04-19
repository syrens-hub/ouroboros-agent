import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EvolutionTimeline } from './EvolutionTimeline'

const mockFetch = vi.fn()
vi.mock('../api', () => ({
  apiFetch: (...args: unknown[]) => mockFetch(...args),
  apiUrl: (path: string) => path,
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function makeHistory() {
  return [
    {
      commit: {
        hash: 'abc123def456',
        shortHash: 'abc123',
        message: 'Add feature X',
        author: 'Alice',
        date: '2025-01-15T10:00:00+08:00',
        tags: [],
        stats: { filesChanged: 3, insertions: 42, deletions: 5 },
      },
      metadata: {
        id: 'rec-1',
        commitHash: 'abc123def456',
        trigger: 'user_request',
        costUsd: 0.1234,
        reviewerModels: ['gpt-4', 'claude-3'],
        userDecision: 'approved',
        riskLevel: 2,
        status: 'completed',
        createdAt: Date.now(),
      },
    },
    {
      commit: {
        hash: 'def789abc012',
        shortHash: 'def789',
        message: 'Fix bug Y',
        author: 'Bob',
        date: '2025-01-14T09:00:00+08:00',
        tags: [],
        stats: { filesChanged: 1, insertions: 10, deletions: 2 },
      },
      metadata: {
        id: 'rec-2',
        commitHash: 'def789abc012',
        trigger: 'background_review',
        costUsd: 0.05,
        reviewerModels: ['gpt-4'],
        userDecision: 'auto',
        riskLevel: 5,
        status: 'pending',
        createdAt: Date.now() - 86400000,
      },
    },
    {
      commit: {
        hash: 'ghi012jkl345',
        shortHash: 'ghi012',
        message: 'Refactor Z',
        author: 'Carol',
        date: '2025-01-13T08:00:00+08:00',
        tags: [],
        stats: { filesChanged: 5, insertions: 120, deletions: 80 },
      },
      metadata: {
        id: 'rec-3',
        commitHash: 'ghi012jkl345',
        trigger: 'user_request',
        costUsd: 0.8,
        reviewerModels: ['claude-3'],
        userDecision: 'rejected',
        riskLevel: 8,
        status: 'rolled_back',
        createdAt: Date.now() - 172800000,
      },
    },
  ]
}

function makeMetrics() {
  return {
    totalEvolutions: 3,
    totalCostUsd: 0.9734,
    avgRiskLevel: 5,
    successRate: 33.3,
    approvalRate: 33.3,
    rollbackRate: 33.3,
    byTrigger: {
      user_request: { count: 2, costUsd: 0.9234 },
      background_review: { count: 1, costUsd: 0.05 },
    },
    byStatus: { completed: 1, pending: 1, rolled_back: 1 },
    avgCostPerEvolution: 0.3245,
    highRiskCount: 1,
  }
}

describe('EvolutionTimeline', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('renders loading state', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}))
    render(<EvolutionTimeline />, { wrapper: Wrapper })
    expect(screen.getByText('Loading evolution history…')).toBeInTheDocument()
  })

  it('renders commits and expands on click', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/metrics')) {
        return { json: async () => ({ data: makeMetrics() }) }
      }
      return { json: async () => ({ data: makeHistory() }) }
    })

    render(<EvolutionTimeline />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeInTheDocument()
    })
    expect(screen.getByText('Fix bug Y')).toBeInTheDocument()
    expect(screen.getByText('Refactor Z')).toBeInTheDocument()

    // Metrics cards
    await waitFor(() => {
      expect(screen.getByText('$0.9734')).toBeInTheDocument()
    })
    expect(screen.getByText('33.3%')).toBeInTheDocument()

    // Expand first item
    const firstRow = screen.getByText('Add feature X').closest('[role="button"]')
    await userEvent.click(firstRow!)

    await waitFor(() => {
      expect(screen.getByText(/\$0\.1234/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Risk 2\/10/)).toBeInTheDocument()
    expect(screen.getByText(/Reviewers: gpt-4, claude-3/)).toBeInTheDocument()
    expect(screen.getByText(/Diff:/)).toBeInTheDocument()
  })

  it('filters by status', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/metrics')) {
        return { json: async () => ({ data: makeMetrics() }) }
      }
      return { json: async () => ({ data: makeHistory() }) }
    })

    render(<EvolutionTimeline />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeInTheDocument()
    })

    const statusSelect = screen.getAllByRole('combobox')[0]
    await userEvent.selectOptions(statusSelect, 'completed')

    await waitFor(() => {
      expect(screen.queryByText('Fix bug Y')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Add feature X')).toBeInTheDocument()
    expect(screen.queryByText('Refactor Z')).not.toBeInTheDocument()
  })

  it('filters by trigger', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/metrics')) {
        return { json: async () => ({ data: makeMetrics() }) }
      }
      return { json: async () => ({ data: makeHistory() }) }
    })

    render(<EvolutionTimeline />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeInTheDocument()
    })

    const triggerSelect = screen.getAllByRole('combobox')[1]
    await userEvent.selectOptions(triggerSelect, 'background_review')

    await waitFor(() => {
      expect(screen.queryByText('Add feature X')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Fix bug Y')).toBeInTheDocument()
  })

  it('clears filters', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/metrics')) {
        return { json: async () => ({ data: makeMetrics() }) }
      }
      return { json: async () => ({ data: makeHistory() }) }
    })

    render(<EvolutionTimeline />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeInTheDocument()
    })

    const statusSelect = screen.getAllByRole('combobox')[0]
    await userEvent.selectOptions(statusSelect, 'completed')
    await waitFor(() => {
      expect(screen.queryByText('Fix bug Y')).not.toBeInTheDocument()
    })

    const clearBtn = screen.getByText('Clear')
    await userEvent.click(clearBtn)

    await waitFor(() => {
      expect(screen.getByText('Fix bug Y')).toBeInTheDocument()
    })
    expect(screen.getByText('Refactor Z')).toBeInTheDocument()
  })

  it('renders empty state when no history', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/metrics')) {
        return { json: async () => ({ data: null }) }
      }
      return { json: async () => ({ data: [] }) }
    })

    render(<EvolutionTimeline />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('No evolution history yet.')).toBeInTheDocument()
    })
  })

  it('renders risk badges', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/metrics')) {
        return { json: async () => ({ data: makeMetrics() }) }
      }
      return { json: async () => ({ data: makeHistory() }) }
    })

    render(<EvolutionTimeline />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('R2')).toBeInTheDocument()
    })
    expect(screen.getByText('R5')).toBeInTheDocument()
    expect(screen.getByText('R8')).toBeInTheDocument()
  })
})
