import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SkillManager } from './SkillManager'

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

describe('SkillManager', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('renders empty skills state', () => {
    render(<SkillManager skills={[]} />, { wrapper: Wrapper })
    expect(screen.getByText('暂无已安装技能')).toBeInTheDocument()
  })

  it('renders skills list', () => {
    const skills = [
      { name: 'greet', version: '1.0.0', description: 'Greeting skill', tags: ['utils'] },
    ]
    render(<SkillManager skills={skills} />, { wrapper: Wrapper })
    expect(screen.getByText('greet')).toBeInTheDocument()
    expect(screen.getByText('Greeting skill')).toBeInTheDocument()
  })

  it('submits install and shows success', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, data: { installed: [{ name: 'new-skill' }] } }),
    })
    render(<SkillManager skills={[]} />, { wrapper: Wrapper })
    const input = screen.getByPlaceholderText('输入 Git URL 或本地路径')
    const button = screen.getByRole('button', { name: /安装/i })

    await userEvent.type(input, 'https://example.com/skill.git')
    await userEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText(/成功安装: new-skill/)).toBeInTheDocument()
    })
  })

  it('submits install and shows error', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: false, error: { message: 'Invalid source' } }),
    })
    render(<SkillManager skills={[]} />, { wrapper: Wrapper })
    const input = screen.getByPlaceholderText('输入 Git URL 或本地路径')
    const button = screen.getByRole('button', { name: /安装/i })

    await userEvent.type(input, 'bad-source')
    await userEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Invalid source')).toBeInTheDocument()
    })
  })

  it('disables install when input is empty', () => {
    render(<SkillManager skills={[]} />, { wrapper: Wrapper })
    const button = screen.getByRole('button', { name: /安装/i })
    expect(button).toBeDisabled()
  })

  it('shows auto-generated badge for generated skills', () => {
    const skills = [
      { name: 'auto-skill', version: '1.0.0', description: 'Auto skill', tags: ['generated', 'utils'] },
    ]
    render(<SkillManager skills={skills} />, { wrapper: Wrapper })
    expect(screen.getByText('自动生成')).toBeInTheDocument()
    expect(screen.getByText('generated')).toBeInTheDocument()
    expect(screen.getByText('utils')).toBeInTheDocument()
  })

  it('triggers skill code generation', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, data: { toolsLoaded: ['toolA'] } }),
    })
    const skills = [
      { name: 'empty-skill', version: '1.0.0', description: 'No code yet', tags: [], hasCode: false },
    ]
    render(<SkillManager skills={skills} />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: /生成代码/i })
    await userEvent.click(btn)
    await waitFor(() => {
      expect(screen.getByText(/代码生成成功: toolA/)).toBeInTheDocument()
    })
  })
})
