import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer } from './ToastContainer'

vi.mock('../api.js', () => ({
  wsUrl: () => 'ws://test/toasts',
}))

class MockWebSocket {
  static instances: MockWebSocket[] = []
  url: string
  onmessage: ((event: { data: string }) => void) | null = null
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
}

describe('ToastContainer', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders empty container', () => {
    render(<ToastContainer />)
    const container = document.querySelector('.fixed.top-4.right-4')
    expect(container).toBeInTheDocument()
    expect(container!.children.length).toBe(0)
  })

  it('renders toast when receiving notification via websocket', () => {
    render(<ToastContainer />)
    expect(MockWebSocket.instances.length).toBe(1)

    const ws = MockWebSocket.instances[0]
    act(() => {
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            event: 'notification',
            data: { type: 'system', title: 'Test Title', message: 'Test message' },
          }),
        })
      }
    })

    expect(screen.getByText('Test Title')).toBeInTheDocument()
    expect(screen.getByText('Test message')).toBeInTheDocument()
  })

  it('removes toast when clicking close button', async () => {
    render(<ToastContainer />)
    const ws = MockWebSocket.instances[0]

    act(() => {
      if (ws.onmessage) {
        ws.onmessage({
          data: JSON.stringify({
            event: 'notification',
            data: { type: 'system', title: 'Close me', message: 'Bye' },
          }),
        })
      }
    })

    expect(screen.getByText('Close me')).toBeInTheDocument()

    const closeBtn = screen.getByRole('button')
    await userEvent.click(closeBtn)

    expect(screen.queryByText('Close me')).not.toBeInTheDocument()
  })
})
