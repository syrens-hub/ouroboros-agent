import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TokenUsagePage } from './TokenUsagePage.jsx'

const mockUseQuery = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mockUseQuery(...args),
}))

describe('TokenUsagePage', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false })
  })

  it('renders header and controls', () => {
    render(<TokenUsagePage sessions={[]} />)
    expect(screen.getByText('Token 用量分析')).toBeInTheDocument()
    expect(screen.getByText('按会话或全局维度查看 Token 消耗趋势')).toBeInTheDocument()
  })

  it('displays total tokens when data is present', () => {
    mockUseQuery.mockReturnValue({
      data: [
        { time: '2024-01-01 00:00', tokens: 100 },
        { time: '2024-01-01 01:00', tokens: 200 },
      ],
      isLoading: false,
    })
    render(<TokenUsagePage sessions={[]} />)
    // Use getAllByText because numbers may appear in multiple cells
    expect(screen.getByText('总 Token 数').nextElementSibling).toHaveTextContent('300')
    expect(screen.getByText('峰值').nextElementSibling).toHaveTextContent('200')
    const rows = screen.getAllByRole('cell')
    expect(rows.some((c) => c.textContent === '200')).toBe(true)
  })

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: true })
    render(<TokenUsagePage sessions={[]} />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })
})
