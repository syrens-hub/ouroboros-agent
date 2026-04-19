import { lazy, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ComputerUseCard } from './ComputerUseCard'
import type { ContentBlock, Message, ComputerUseData } from '../../types/chat'

const CodeBlock = lazy(() => import('../CodeBlock'))

function escapeHtml(str: string): string {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m))
}

function isUrlSafe(url: string): boolean {
  try {
    const u = new URL(url, window.location.href)
    return ['http:', 'https:', 'blob:', 'data:'].includes(u.protocol)
  } catch {
    return false
  }
}

interface MessageContentProps {
  msg: Message
  onImageClick?: (url: string) => void
}

export function MessageContent({ msg, onImageClick }: MessageContentProps) {
  const blocks = ((): ContentBlock[] => {
    if (typeof msg.content === 'string') {
      try {
        const parsed = JSON.parse(msg.content)
        if (Array.isArray(parsed)) return parsed as ContentBlock[]
      } catch {
        // ignore
      }
      return [{ type: 'text', text: msg.content }]
    }
    if (Array.isArray(msg.content)) {
      return msg.content as ContentBlock[]
    }
    return [{ type: 'text', text: JSON.stringify(msg.content) }]
  })()

  const textBlocks = blocks
    .map((b) => {
      if (b.type === 'text') return b.text
      if (b.type === 'tool_use') return `[调用工具: ${b.name}]`
      return ''
    })
    .filter(Boolean)
    .join('\n')

  const thinkMatch = textBlocks.match(/<think>([\s\S]*?)<\/think>/)
  const thinkContent = thinkMatch ? thinkMatch[1].trim() : ''
  const mainContent = thinkContent ? textBlocks.replace(/<think>[\s\S]*?<\/think>/, '').trim() : textBlocks

  const imageBlocks = blocks.filter((b) => b.type === 'image_url' && b.image_url?.url)

  let computerUseData: ComputerUseData | null = null
  try {
    const parsed = JSON.parse(textBlocks)
    if (parsed && (parsed._running === true || (parsed.success && Array.isArray(parsed.history) && typeof parsed.stepsTaken === 'number'))) {
      computerUseData = parsed as ComputerUseData
    }
  } catch {
    // ignore
  }

  if (msg.role === 'computer_use' || computerUseData) {
    return <ComputerUseCard data={computerUseData || { _running: true, _steps: [] }} onImageClick={onImageClick} />
  }

  if (msg.role !== 'assistant') {
    return (
      <div className="whitespace-pre-wrap">
        {textBlocks && <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: escapeHtml(textBlocks) }} />}
        {imageBlocks.map((b, i) => (
          <img
            key={i}
            src={isUrlSafe(b.image_url!.url) ? b.image_url!.url : ''}
            alt="uploaded"
            className="mt-2 max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
            onClick={() => onImageClick && onImageClick(b.image_url!.url)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="prose prose-invert">
      {thinkContent && (
        <details className="mb-2 rounded border border-white/10 bg-secondary/30 text-sm">
          <summary className="cursor-pointer select-none px-3 py-2 text-muted hover:text-white">
            推理过程
          </summary>
          <pre className="m-0 overflow-auto whitespace-pre-wrap px-3 pb-3 text-xs text-muted">
            {thinkContent}
          </pre>
        </details>
      )}
      {(mainContent || !thinkContent) && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img({ src, alt, ..._props }: React.ComponentProps<'img'>) {
              if (!src || !isUrlSafe(src)) return <img src="" alt={alt || ''} />
              return (
                <img
                  src={src}
                  alt={alt || ''}
                  className="mt-2 max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
                  onClick={() => onImageClick && onImageClick(src)}
                />
              )
            },
            code({ inline, className, children, ...props }: React.ComponentProps<'code'> & { inline?: boolean }) {
              const match = /language-(\w+)/.exec(className || '')
              return !inline && match ? (
                <Suspense fallback={<div className="my-3 p-4 bg-secondary/30 rounded-lg text-xs text-muted">Loading code highlight...</div>}>
                  <CodeBlock language={match[1]}>{children}</CodeBlock>
                </Suspense>
              ) : (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            },
            a({ href, children, ...props }: React.ComponentProps<'a'>) {
              const safeHref = typeof href === 'string' && !/^(javascript|data|vbscript):/i.test(href) ? href : '#'
              return (
                <a href={safeHref} {...props} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              )
            },
          }}
        >
          {mainContent || textBlocks}
        </ReactMarkdown>
      )}
      {imageBlocks.map((b, i) => (
        <img
          key={i}
          src={isUrlSafe(b.image_url!.url) ? b.image_url!.url : ''}
          alt="uploaded"
          className="mt-2 max-w-xs rounded-lg border border-white/10 cursor-zoom-in"
          onClick={() => onImageClick && onImageClick(b.image_url!.url)}
        />
      ))}
    </div>
  )
}
