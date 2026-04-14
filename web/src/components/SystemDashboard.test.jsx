import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SystemDashboard } from './SystemDashboard.jsx'
import { I18nProvider } from '../i18n/index.jsx'

const mockFetch = vi.fn()
vi.mock('../api.js', () => ({
  apiFetch: (...args) => mockFetch(...args),
  apiUrl: (path) => path,
}))

function Wrapper({ children }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  )
}

describe('SystemDashboard', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('alert', vi.fn())
    vi.stubGlobal('confirm', vi.fn())
    // Default mock for concurrent useQuery calls
    mockFetch.mockImplementation(async (path) => {
      if (path === '/api/im/status') {
        return { json: async () => ({ data: { feishu: { available: false }, mockChat: { available: true } } }) }
      }
      if (path === '/api/daemon/history') {
        return { json: async () => ({ data: [] }) }
      }
      if (path === '/api/backup/db/list') {
        return { json: async () => ({ data: [{ filename: 'b1.db', createdAt: Date.now(), sizeBytes: 1024 }] }) }
      }
      if (path === '/api/learning/patterns') {
        return { json: async () => ({ data: [] }) }
      }
      if (path === '/api/learning/config') {
        return { json: async () => ({ data: {} }) }
      }
      if (path === '/api/self-healing/status') {
        return { json: async () => ({ data: { active: false, snapshots: 0 } }) }
      }
      if (path === '/api/kb/stats') {
        return { json: async () => ({ data: { totalDocuments: 3, totalChunks: 12, avgPromotionScore: 0.45 } }) }
      }
      return { json: async () => ({}) }
    })
  })

  it('renders status and metrics cards', () => {
    render(<SystemDashboard status={{ sessionCount: 5, llmProvider: 'openai', llmModel: 'gpt-4', daemonRunning: false, memoryRecalls24h: 15 }} />, { wrapper: Wrapper })
    expect(screen.getByText('系统检查')).toBeInTheDocument()
    expect(screen.getByText('会话数')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('记忆召回')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
  })

  it('renders kb stats card', async () => {
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    expect(await screen.findByText('KB Chunks')).toBeInTheDocument()
    expect(await screen.findByText('12')).toBeInTheDocument()
  })

  it('runs health check on click', async () => {
    render(<SystemDashboard status={{ llmProvider: 'openai', daemonRunning: true }} />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: /自检/i })
    await userEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByText('系统正常')).toBeInTheDocument()
    }, { timeout: 3000 })
    expect(screen.getByText('LLM 连接')).toBeInTheDocument()
    expect(screen.getByText('SessionDB')).toBeInTheDocument()
  })

  it('starts daemon', async () => {
    mockFetch.mockResolvedValueOnce({})
    render(<SystemDashboard status={{ daemonRunning: false }} />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: /启动 Daemon/i })
    await userEvent.click(btn)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/daemon/start', { method: 'POST' })
    })
  })

  it('stops daemon', async () => {
    mockFetch.mockResolvedValueOnce({})
    render(<SystemDashboard status={{ daemonRunning: true }} />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: /暂停 Daemon/i })
    await userEvent.click(btn)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/daemon/stop', { method: 'POST' })
    })
  })

  it('renders backup list and triggers restore', async () => {
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    const backupName = await screen.findByText('b1.db', {}, { timeout: 3000 })
    expect(backupName).toBeInTheDocument()
    confirm.mockReturnValueOnce(true)
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true }) })
    const restoreBtn = screen.getByRole('button', { name: /恢复/i })
    await userEvent.click(restoreBtn)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/backup/db/restore', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('renders learning insights card', async () => {
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    expect(await screen.findByText('学习洞察')).toBeInTheDocument()
  })

  it('renders deep dreaming status', () => {
    render(<SystemDashboard status={{ deepDreamingLastRun: Date.now() }} />, { wrapper: Wrapper })
    expect(screen.getByText('Deep Dreaming')).toBeInTheDocument()
  })
})
