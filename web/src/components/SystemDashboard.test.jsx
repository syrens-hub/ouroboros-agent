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
      if (path === '/api/app-metrics') {
        return { json: async () => ({ data: {} }) }
      }
      if (path === '/api/tasks') {
        return { json: async () => ({ data: [] }) }
      }
      if (path === '/api/system/circuit-breakers') {
        return { json: async () => ({ data: [] }) }
      }
      if (path === '/api/tasks/queue-stats') {
        return { json: async () => ({ data: { pending: 0, failed: 0, delayed: 0 } }) }
      }
      if (path === '/api/budget') {
        return { json: async () => ({ data: { totalBudget: 50, usedEstimate: 10, remainingPercent: 80, status: 'ok', llmCalls24h: 42, tokenUsage24h: 1234 } }) }
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

  it('renders budget card with ok status', async () => {
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    expect(await screen.findByText('预算监控')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText('正常').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('1,234').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('42').length).toBeGreaterThanOrEqual(1)
    })
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

  it('tests LLM connection', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: { ok: true } }) })
    render(<SystemDashboard status={{ llmProvider: 'openai' }} />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: /测试 LLM/i })
    await userEvent.click(btn)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/llm/test', { method: 'POST' })
    })
  })

  it('exports trajectory backup', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: { count: 5, path: '/tmp/out.jsonl' } }) })
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: /备份轨迹/i })
    await userEvent.click(btn)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/backup/export', { method: 'POST' })
    })
  })

  it('creates database backup', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: { filename: 'new.db' } }) })
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: /立即备份/i })
    await userEvent.click(btn)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/backup/db/create', { method: 'POST' })
    })
  })

  it('renders circuit breaker panel', async () => {
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    expect(await screen.findByText('LLM 熔断器状态')).toBeInTheDocument()
  })

  it('renders queue stats', async () => {
    render(<SystemDashboard status={{}} />, { wrapper: Wrapper })
    expect(await screen.findByText('待处理')).toBeInTheDocument()
    expect(await screen.findByText('失败')).toBeInTheDocument()
  })
})
