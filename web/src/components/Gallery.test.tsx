import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Gallery } from './Gallery'

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
}))

describe('Gallery', () => {
  let mutateFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mutateFn = vi.fn()
    mockUseQuery.mockReturnValue({ data: null, isLoading: false })
    mockUseMutation.mockReturnValue({
      mutate: mutateFn,
      isPending: false,
      isSuccess: false,
      data: null,
    })
  })

  it('renders screenshots tab by default', () => {
    render(<Gallery />)
    expect(screen.getByText('截图')).toBeInTheDocument()
    expect(screen.getByText('画布')).toBeInTheDocument()
    expect(screen.getByText('暂无截图')).toBeInTheDocument()
  })

  it('renders screenshot list when data is present', () => {
    mockUseQuery.mockReturnValue({
      data: {
        data: [
          { url: '/api/gallery/screenshots/1.png', filename: 'test.png' },
        ],
      },
      isLoading: false,
    })
    render(<Gallery />)
    expect(screen.getByText('test.png')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/gallery/screenshots/1.png')
  })

  it('switches to canvas tab', () => {
    render(<Gallery />)
    fireEvent.click(screen.getByText('画布'))
    expect(screen.getByText('矩形')).toBeInTheDocument()
    expect(screen.getByText('圆形')).toBeInTheDocument()
    expect(screen.getByText('文字')).toBeInTheDocument()
  })

  it('adds rect command and calls mutate', () => {
    render(<Gallery />)
    fireEvent.click(screen.getByText('画布'))
    fireEvent.click(screen.getByText('矩形'))
    expect(mutateFn).toHaveBeenCalledTimes(1)
    const payload = mutateFn.mock.calls[0][0]
    expect(payload.width).toBe(400)
    expect(payload.height).toBe(300)
    expect(payload.commands).toHaveLength(1)
    expect(payload.commands[0].type).toBe('rect')
  })

  it('shows canvas result on mutation success', () => {
    mockUseMutation.mockReturnValue({
      mutate: mutateFn,
      isPending: false,
      isSuccess: true,
      data: { success: true, data: { dataUrl: 'data:image/png;base64,abc' } },
    })
    render(<Gallery />)
    fireEvent.click(screen.getByText('画布'))
    expect(screen.getByRole('img', { name: 'canvas' })).toHaveAttribute('src', 'data:image/png;base64,abc')
  })
})
