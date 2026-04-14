import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryBrowser } from './MemoryBrowser.jsx'

const mockApiFetch = vi.fn()

vi.mock('../api.js', () => ({
  apiFetch: (...args) => mockApiFetch(...args),
}))

describe('MemoryBrowser', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    window.__OUROBOROS_API_TOKEN__ = 'test-token'
  })

  it('renders header and layer filters', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    })
    render(<MemoryBrowser />)
    expect(screen.getByText('记忆层')).toBeInTheDocument()
    expect(screen.getByText('全部')).toBeInTheDocument()
    expect(screen.getByText('learning')).toBeInTheDocument()
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
  })

  it('renders memory items and expands content', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: '1',
            layer: 'learning',
            content: 'a'.repeat(400),
            score: 0.95,
            source_path: '/path/to/source',
            updated_at: Date.now(),
          },
        ],
      }),
    })
    render(<MemoryBrowser />)
    await waitFor(() => expect(screen.getByText('learning')).toBeInTheDocument())
    expect(screen.getByText('0.95')).toBeInTheDocument()
    expect(screen.getByText('/path/to/source')).toBeInTheDocument()

    fireEvent.click(screen.getByText('展开全文'))
    expect(screen.getByText('收起')).toBeInTheDocument()
  })

  it('searches memory by query', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    })
    render(<MemoryBrowser />)
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1))
    const input = screen.getByPlaceholderText('搜索记忆内容...')
    fireEvent.change(input, { target: { value: 'test query' } })
    const form = input.closest('form')
    fireEvent.submit(form)
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenLastCalledWith(
        expect.stringContaining('/api/memory/search?q=test%20query')
      )
    )
  })

  it('shows error message on fetch failure', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'))
    render(<MemoryBrowser />)
    await waitFor(() => expect(screen.getByText(/Network error/)).toBeInTheDocument())
  })
})
