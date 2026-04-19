import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

// @ts-expect-error react-syntax-highlighter lacks type declarations
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import html from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
// @ts-expect-error react-syntax-highlighter lacks type declarations
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'

SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('js', javascript)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('ts', typescript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('py', python)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('sh', bash)
SyntaxHighlighter.registerLanguage('shell', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('md', markdown)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('html', html)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('yml', yaml)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('rs', rust)
SyntaxHighlighter.registerLanguage('java', java)

interface CodeBlockProps {
  language?: string
  children: React.ReactNode
}

export default function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const code = String(children).replace(/\n$/, '')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border/60 shadow-2xl my-3 bg-[#0d1117]">
      <div className="flex items-center justify-between px-3 py-2 bg-[#161b22] border-b border-border/40">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
          </div>
          {language && (
            <span className="ml-3 text-[10px] font-semibold uppercase tracking-wider text-muted px-1.5 py-0.5 rounded bg-secondary/60">
              {language}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-white transition"
          title="复制"
        >
          {copied ? <Check className="w-3 h-3 text-ok" /> : <Copy className="w-3 h-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <SyntaxHighlighter
        style={vscDarkPlus as any}
        language={language || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, padding: '1rem', background: '#0d1117', fontSize: '0.8125rem' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
