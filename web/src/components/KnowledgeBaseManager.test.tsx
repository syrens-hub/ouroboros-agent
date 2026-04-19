import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KnowledgeBaseManager } from './KnowledgeBaseManager'

const mockFetch = vi.fn()

vi.mock('../api', () => ({
  apiFetch: (...args: unknown[]) => mockFetch(...args),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('KnowledgeBaseManager', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
  })

  it('renders upload and query sections', () => {
    render(<KnowledgeBaseManager />, { wrapper: Wrapper })
    expect(screen.getByText('上传知识')).toBeInTheDocument()
    expect(screen.getByText('查询知识库')).toBeInTheDocument()
    expect(screen.getByText('文档列表')).toBeInTheDocument()
  })

  it('switches upload tabs', async () => {
    render(<KnowledgeBaseManager />, { wrapper: Wrapper })
    await userEvent.click(screen.getByRole('button', { name: '上传文件' }))
    expect(screen.getByText('上传文件')).toBeInTheDocument()
  })

  it('ingests text and shows success', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true }) })
    render(<KnowledgeBaseManager />, { wrapper: Wrapper })

    const textarea = screen.getByPlaceholderText('在此粘贴文本...')
    await userEvent.type(textarea, 'hello world')
    await userEvent.click(screen.getByRole('button', { name: /Ingest/i }))

    await waitFor(() => {
      expect(screen.getByText('上传成功')).toBeInTheDocument()
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/kb/ingest', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'global', source: 'hello world', isFile: false }),
    })
  })

  it('queries and renders results', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: [
          { content: 'result one', score: 0.95 },
          { content: 'result two', score: 0.88 },
        ],
      }),
    })
    render(<KnowledgeBaseManager />, { wrapper: Wrapper })

    const input = screen.getByPlaceholderText('输入查询内容...')
    await userEvent.type(input, 'test query')
    await userEvent.click(screen.getByRole('button', { name: /Query/i }))

    await waitFor(() => {
      expect(screen.getByText('result one')).toBeInTheDocument()
      expect(screen.getByText('result two')).toBeInTheDocument()
    })
  })

  it('renders document list', async () => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: [
          { filename: 'doc.md', format: 'markdown', size: '12KB', chunkCount: 3 },
        ],
      }),
    })
    render(<KnowledgeBaseManager />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.getByText('doc.md')).toBeInTheDocument()
      expect(screen.getByText('markdown')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })
  })
})
