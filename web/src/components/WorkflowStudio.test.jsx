import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowStudio } from './WorkflowStudio.jsx'

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

describe('WorkflowStudio', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('renders CrewAI tab by default', () => {
    render(<WorkflowStudio />, { wrapper: Wrapper })
    expect(screen.getByText('CrewAI')).toBeInTheDocument()
    expect(screen.getByText('Task')).toBeInTheDocument()
  })

  it('switches to SOP tab and loads templates', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: [{ id: 't1', name: 'Template One', definition: { steps: [] } }],
      }),
    })
    render(<WorkflowStudio />, { wrapper: Wrapper })
    await userEvent.click(screen.getByRole('button', { name: 'SOP' }))
    await waitFor(() => {
      expect(screen.getByText('Template One')).toBeInTheDocument()
    })
  })

  it('runs CrewAI and displays result', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { results: { r1: 'ok' }, finalOutput: 'done' },
      }),
    })
    render(<WorkflowStudio />, { wrapper: Wrapper })

    const taskInput = screen.getByPlaceholderText('输入任务描述...')
    await userEvent.type(taskInput, 'do research')
    await userEvent.click(screen.getByRole('button', { name: /Run/i }))

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument()
    })
  })

  it('selects template and runs SOP', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: [{ id: 't1', name: 'Template One', definition: { steps: [] } }],
      }),
    })
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { outputs: { result: 'success' } },
      }),
    })
    render(<WorkflowStudio />, { wrapper: Wrapper })

    await userEvent.click(screen.getByRole('button', { name: 'SOP' }))
    await waitFor(() => {
      expect(screen.getByText('Template One')).toBeInTheDocument()
    })

    await userEvent.selectOptions(screen.getByRole('combobox'), 't1')
    await waitFor(() => {
      expect(screen.getByText(/steps/)).toBeInTheDocument()
    })

    const runButtons = screen.getAllByRole('button', { name: /Run/i })
    await userEvent.click(runButtons[runButtons.length - 1])

    await waitFor(() => {
      expect(screen.getByText(/result/)).toBeInTheDocument()
      expect(screen.getByText(/success/)).toBeInTheDocument()
    })
  })
})
