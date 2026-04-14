import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ChatView } from './ChatView.jsx'

const mockFetch = vi.fn()
const mockSend = vi.fn()
const mockConnect = vi.fn()
const mockClose = vi.fn()

vi.mock('../api.js', () => ({
  apiFetch: (...args) => mockFetch(...args),
  wsUrl: (sessionId) => `ws://test/ws?sessionId=${sessionId || ''}`,
}))

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ connect: mockConnect, close: mockClose, send: mockSend }),
}))

vi.mock('react-markdown', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({ children }) => <pre>{children}</pre>,
}))

vi.mock('../utils/image.js', () => ({
  compressImage: (file) => Promise.resolve(file),
}))

class MockWebSocket {
  static instances = []
  constructor(url) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  close = vi.fn()
  send = vi.fn()
}

function Wrapper({ children }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('ChatView', () => {
  class MockFileReader {
    static instances = []
    constructor() {
      MockFileReader.instances.push(this)
    }
    readAsText = vi.fn()
    onload = null
  }

  beforeEach(() => {
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
    vi.stubGlobal('FileReader', MockFileReader)
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test-url'), revokeObjectURL: vi.fn() })
    vi.stubGlobal('speechSynthesis', {
      speak: vi.fn(),
      cancel: vi.fn(),
      getVoices: vi.fn(() => []),
    })
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(text) { this.text = text; this.lang = '' }
    })
    Element.prototype.scrollIntoView = vi.fn()
    mockFetch.mockReset()
    mockSend.mockReset()
    mockConnect.mockReset()
    mockClose.mockReset()
    MockWebSocket.instances = []
    MockFileReader.instances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete Element.prototype.scrollIntoView
  })

  const sessions = [
    { sessionId: 's1', title: 'Session One' },
    { sessionId: 's2', title: 'Session Two' },
  ]

  it('renders session list and empty state', () => {
    render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
    expect(screen.getByText('Session One')).toBeInTheDocument()
    expect(screen.getByText('Session Two')).toBeInTheDocument()
    expect(screen.getByText('选择一个会话')).toBeInTheDocument()
  })

  it('loads messages when selecting a session', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [{ role: 'user', content: 'hi', timestamp: Date.now() }] }) })
    render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
    await userEvent.click(screen.getByText('Session One'))
    await waitFor(() => {
      expect(screen.getByText('hi')).toBeInTheDocument()
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/sessions/s1/messages')
  })

  it('sends a chat message via websocket', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
    await userEvent.click(screen.getByText('Session One'))

    const input = screen.getByPlaceholderText('输入消息...')
    const sendBtn = screen.getByRole('button', { name: /发送/i })
    await userEvent.type(input, 'hello bot')
    await userEvent.click(sendBtn)

    expect(mockConnect).toHaveBeenCalledWith('s1', expect.any(Object))
    // Simulate onOpen callback to trigger send
    const onOpen = mockConnect.mock.calls[0][1].onOpen
    onOpen()
    expect(mockSend).toHaveBeenCalledWith({ type: 'chat', message: 'hello bot' })
  })

  it('shows confirm modal and handles confirm', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
    await userEvent.click(screen.getByText('Session One'))

    // Trigger connect to capture handlers
    const connectArgs = []
    mockConnect.mockImplementation((sid, handlers) => {
      connectArgs.push({ sid, handlers })
    })

    const input = screen.getByPlaceholderText('输入消息...')
    await userEvent.type(input, 'do it')
    await userEvent.click(screen.getByRole('button', { name: /发送/i }))

    // Fire confirm_request event
    act(() => {
      connectArgs[0].handlers.onEvent({ event: 'confirm_request', toolName: 'write_file', input: { path: 'x' }, timeoutMs: 60000 })
    })
    await waitFor(() => {
      expect(screen.getByText(/权限确认/)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /允许/i }))
    expect(mockSend).toHaveBeenCalledWith({ type: 'confirm', allowed: true })
  })

  it('handles file drop on input', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
    render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
    await userEvent.click(screen.getByText('Session One'))

    const file = new File(['hello world'], 'test.txt', { type: 'text/plain' })
    const inputContainer = screen.getByPlaceholderText('输入消息...').parentElement.parentElement

    await act(async () => {
      // eslint-disable-next-line no-undef
      const dropEvent = new Event('drop', { bubbles: true })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [file] },
      })
      inputContainer.dispatchEvent(dropEvent)
    })

    // Trigger FileReader onload
    const readerInstance = MockFileReader.instances[MockFileReader.instances.length - 1]
    await act(async () => {
      readerInstance.onload({ target: { result: 'hello world' } })
    })

    await waitFor(() => {
      const input = screen.getByPlaceholderText('输入消息...')
      expect(input.value).toContain('[文件名: test.txt]')
      expect(input.value).toContain('hello world')
    })
  })

  it('loads older messages on scroll-up', async () => {
    const initialMessages = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      role: 'user',
      content: `msg-${i + 1}`,
      timestamp: Date.now(),
    }))
    const olderMessages = [
      { id: 21, role: 'user', content: 'older-msg', timestamp: Date.now() },
    ]

    mockFetch
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: initialMessages }) })
      .mockResolvedValueOnce({ json: async () => ({ success: true, data: olderMessages }) })

    render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
    await userEvent.click(screen.getByText('Session One'))

    await waitFor(() => {
      expect(screen.getByText('msg-1')).toBeInTheDocument()
    })

    const container = screen.getByTestId('messages-container')
    expect(container).toBeTruthy()

    await act(async () => {
      container.scrollTop = 0
      container.dispatchEvent(new window.Event('scroll', { bubbles: true }))
    })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/sessions/s1/messages?beforeId=1&limit=20')
    })

    await waitFor(() => {
      expect(screen.getByText('older-msg')).toBeInTheDocument()
    })
  })

  describe('multimodal', () => {
    const recInstances = []
    beforeEach(() => {
      recInstances.length = 0
      class MockSpeechRecognition {
        constructor() {
          this.lang = ''
          this.continuous = false
          this.interimResults = false
          this.onresult = null
          this.onerror = null
          this.onend = null
          recInstances.push(this)
        }
        start = vi.fn()
        stop = vi.fn()
      }
      vi.stubGlobal('webkitSpeechRecognition', MockSpeechRecognition)
    })

    it('uploads pasted image and sends content array', async () => {
      mockFetch
        .mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
        .mockResolvedValueOnce({ json: async () => ({ success: true, data: { url: '/api/uploads/s1/paste.png', name: 'paste.png' } }) })

      render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
      await userEvent.click(screen.getByText('Session One'))

      const input = screen.getByPlaceholderText('输入消息...')
      const file = new File(['dummy'], 'paste.png', { type: 'image/png' })
      const clipboardData = { items: [{ type: 'image/png', getAsFile: () => file }] }

      await act(async () => {
        const pasteEvent = new Event('paste', { bubbles: true })
        Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })
        input.dispatchEvent(pasteEvent)
      })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/upload?sessionId=s1', expect.any(Object))
      })

      await userEvent.type(input, 'describe this')
      await userEvent.click(screen.getByRole('button', { name: /发送/i }))

      const onOpen = mockConnect.mock.calls[0][1].onOpen
      onOpen()

      await waitFor(() => {
        expect(mockSend).toHaveBeenCalledWith({
          type: 'chat',
          content: [
            { type: 'text', text: 'describe this' },
            { type: 'image_url', image_url: { url: '/api/uploads/s1/paste.png' } },
          ],
        })
      })
    })

    it('toggles voice input with SpeechRecognition', async () => {
      mockFetch.mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
      render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
      await userEvent.click(screen.getByText('Session One'))

      const micBtn = screen.getByTitle('语音输入')
      await userEvent.click(micBtn)

      const recInstance = recInstances[recInstances.length - 1]
      expect(recInstance).toBeTruthy()

      await act(async () => {
        const resultItem = [{ transcript: 'hello voice' }]
        resultItem.isFinal = true
        recInstance.onresult({ resultIndex: 0, results: [resultItem] })
      })

      await waitFor(() => {
        const input = screen.getByPlaceholderText('输入消息...')
        expect(input.value).toBe('hello voice')
      })
    })

    it('renders image_url blocks in messages', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: 'http://test/img.png' } },
                { type: 'text', text: 'check this' },
              ],
              timestamp: Date.now(),
            },
          ],
        }),
      })

      render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
      await userEvent.click(screen.getByText('Session One'))

      await waitFor(() => {
        expect(screen.getByAltText('uploaded')).toHaveAttribute('src', 'http://test/img.png')
        expect(screen.getByText('check this')).toBeInTheDocument()
      })
    })

    it('opens lightbox when clicking an image in message', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: [
            {
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: 'http://test/img.png' } }],
              timestamp: Date.now(),
            },
          ],
        }),
      })

      render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
      await userEvent.click(screen.getByText('Session One'))

      await waitFor(() => {
        expect(screen.getByAltText('uploaded')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByAltText('uploaded'))
      expect(screen.getByAltText('Preview')).toHaveAttribute('src', 'http://test/img.png')

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      expect(screen.queryByAltText('Preview')).not.toBeInTheDocument()
    })

    it('speaks assistant message via TTS', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          success: true,
          data: [
            { role: 'assistant', content: 'Hello world', timestamp: Date.now() },
          ],
        }),
      })

      render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
      await userEvent.click(screen.getByText('Session One'))

      await waitFor(() => {
        expect(screen.getByText('Hello world')).toBeInTheDocument()
      })

      const speakBtn = screen.getByTitle('朗读')
      await userEvent.click(speakBtn)

      expect(window.speechSynthesis.cancel).toHaveBeenCalled()
      expect(window.speechSynthesis.speak).toHaveBeenCalled()
      const utterance = window.speechSynthesis.speak.mock.calls[0][0]
      expect(utterance.text).toBe('Hello world')
    })

    it('shows generic file chip in attachment strip', async () => {
      mockFetch
        .mockResolvedValueOnce({ json: async () => ({ success: true, data: [] }) })
        .mockResolvedValueOnce({ json: async () => ({ success: true, data: { url: '/api/uploads/s1/report.pdf', name: 'report.pdf' } }) })

      render(<ChatView sessions={sessions} systemStatus={{}} />, { wrapper: Wrapper })
      await userEvent.click(screen.getByText('Session One'))

      const file = new File(['pdf-bytes'], 'report.pdf', { type: 'application/pdf' })
      const uploadInput = screen.getByTitle('上传文件').querySelector('input')

      await userEvent.upload(uploadInput, file)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/upload/file?sessionId=s1', expect.any(Object))
      })

      await waitFor(() => {
        expect(screen.getByText('report.pdf')).toBeInTheDocument()
      })
    })
  })
})
