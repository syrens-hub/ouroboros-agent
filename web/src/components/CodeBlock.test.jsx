import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CodeBlock from './CodeBlock.jsx'

vi.mock('react-syntax-highlighter', () => ({
  PrismLight: Object.assign(
    ({ children }) => <pre data-testid="syntax-highlighter">{children}</pre>,
    { registerLanguage: vi.fn() }
  ),
}))

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  vscDarkPlus: {},
}))

vi.mock('react-syntax-highlighter/dist/esm/languages/prism/javascript', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/typescript', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/tsx', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/python', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/bash', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/json', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/markdown', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/css', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/markup', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/yaml', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/go', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/rust', () => ({ default: {} }))
vi.mock('react-syntax-highlighter/dist/esm/languages/prism/java', () => ({ default: {} }))

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders code content and copy button', () => {
    render(<CodeBlock language="javascript">console.log('hello')</CodeBlock>)
    expect(screen.getByText('javascript')).toBeInTheDocument()
    expect(screen.getByText("console.log('hello')")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复制/i })).toBeInTheDocument()
  })

  it('copies code to clipboard when clicking copy button', async () => {
    render(<CodeBlock language="python">print('hi')</CodeBlock>)
    const btn = screen.getByRole('button', { name: /复制/i })
    await userEvent.click(btn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("print('hi')")
    expect(screen.getByText('已复制')).toBeInTheDocument()
  })

  it('renders without language label when language is omitted', () => {
    render(<CodeBlock>some text</CodeBlock>)
    expect(screen.getByText('some text')).toBeInTheDocument()
    expect(screen.queryByText('text')).not.toBeInTheDocument()
  })
})
