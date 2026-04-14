import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Gallery } from './Gallery.jsx'

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

describe('Gallery', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('shows empty screenshots message by default', () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    render(<Gallery />, { wrapper: Wrapper })
    expect(screen.getByText('暂无截图')).toBeInTheDocument()
  })

  it('switches to canvas tab', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    render(<Gallery />, { wrapper: Wrapper })
    await userEvent.click(screen.getByRole('button', { name: '画布' }))
    expect(screen.getByText('JSON Preview')).toBeInTheDocument()
  })

  it('renders screenshot thumbnails', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: [
          { filename: 'sc1.png', url: '/sc1.png' },
          { filename: 'sc2.png', url: '/sc2.png' },
        ],
      }),
    })
    render(<Gallery />, { wrapper: Wrapper })
    await waitFor(() => {
      expect(screen.getByText('sc1.png')).toBeInTheDocument()
      expect(screen.getByText('sc2.png')).toBeInTheDocument()
    })
  })

  it('draws canvas and renders image on shape click', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { dataUrl: 'data:image/png;base64,abc123' },
      }),
    })
    render(<Gallery />, { wrapper: Wrapper })
    await userEvent.click(screen.getByRole('button', { name: '画布' }))
    await userEvent.click(screen.getByRole('button', { name: '矩形' }))

    await waitFor(() => {
      expect(screen.getByAltText('canvas')).toHaveAttribute('src', 'data:image/png;base64,abc123')
    })
  })
})
