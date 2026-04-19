import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload,
  FileText,
  Search,
  Database,
  Loader2,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { apiFetch } from '../api'

interface Document {
  filename: string
  format?: string
  size?: string
  chunkCount?: number
}

interface QueryResult {
  content?: string
  score?: number
}

interface IngestBody {
  sessionId: string
  source: string
  isFile: boolean
}

interface QueryBody {
  sessionId: string
  query: string
  topK: number
}

interface IngestResponse {
  success: boolean
  error?: { message?: string }
}

interface QueryResponse {
  success: boolean
  data?: QueryResult[]
  error?: { message?: string }
}

async function ingestDocument(body: IngestBody): Promise<IngestResponse> {
  const res = await apiFetch('/api/kb/ingest', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return (await res.json()) as IngestResponse
}

async function queryKnowledgeBase(body: QueryBody): Promise<QueryResponse> {
  const res = await apiFetch('/api/kb/query', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return (await res.json()) as QueryResponse
}

async function fetchDocuments(): Promise<unknown> {
  const res = await apiFetch('/api/kb/documents')
  return res.json()
}

export function KnowledgeBaseManager() {
  const queryClient = useQueryClient()
  const [uploadTab, setUploadTab] = useState('text')
  const [textSource, setTextSource] = useState('')
  const [fileName, setFileName] = useState('')
  const [query, setQuery] = useState('')

  const { data: documentsData } = useQuery({
    queryKey: ['kb-documents'],
    queryFn: fetchDocuments,
  })

  const ingestMutation = useMutation({
    mutationFn: ingestDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kb-documents'] }),
  })
  const queryMutation = useMutation({ mutationFn: queryKnowledgeBase })

  const documents = (documentsData as { data?: Document[] } | undefined)?.data || []

  const handleIngest = () => {
    if (uploadTab === 'text') {
      if (!textSource.trim()) return
      ingestMutation.mutate({ sessionId: 'global', source: textSource, isFile: false })
    } else {
      if (!fileName.trim()) return
      ingestMutation.mutate({ sessionId: 'global', source: fileName, isFile: true })
    }
  }

  const handleQuery = () => {
    if (!query.trim()) return
    queryMutation.mutate({ sessionId: 'global', query, topK: 5 })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setFileName(file.name)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left Column */}
      <div className="space-y-5">
        {/* Upload Card */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-lg font-semibold text-text-strong mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-accent" />
            上传知识
          </h2>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setUploadTab('text')}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                uploadTab === 'text'
                  ? 'bg-accent text-white'
                  : 'bg-secondary hover:bg-secondary/70 text-muted'
              }`}
            >
              粘贴文本
            </button>
            <button
              onClick={() => setUploadTab('file')}
              className={`px-3 py-1.5 rounded-lg text-sm transition ${
                uploadTab === 'file'
                  ? 'bg-accent text-white'
                  : 'bg-secondary hover:bg-secondary/70 text-muted'
              }`}
            >
              上传文件
            </button>
          </div>

          {uploadTab === 'text' ? (
            <textarea
              value={textSource}
              onChange={(e) => setTextSource(e.target.value)}
              placeholder="在此粘贴文本..."
              rows={6}
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-sm outline-none focus:border-accent resize-none"
            />
          ) : (
            <div className="space-y-3">
              <input
                type="file"
                accept=".md,.txt,.json"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:bg-secondary file:text-text-strong hover:file:bg-secondary/70"
              />
              {fileName && (
                <div className="text-sm text-muted flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {fileName}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleIngest}
            disabled={ingestMutation.isPending || (uploadTab === 'text' ? !textSource.trim() : !fileName.trim())}
            className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-secondary rounded-lg text-white text-sm flex items-center gap-2 transition"
          >
            {ingestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Ingest
          </button>

          {ingestMutation.isSuccess && (
            <div className={`mt-3 text-sm flex items-start gap-2 ${ingestMutation.data?.success ? 'text-ok' : 'text-danger'}`}>
              {ingestMutation.data?.success ? <CheckCircle className="w-4 h-4 mt-0.5" /> : <XCircle className="w-4 h-4 mt-0.5" />}
              <div>{ingestMutation.data?.success ? '上传成功' : ingestMutation.data?.error?.message || '上传失败'}</div>
            </div>
          )}
        </div>

        {/* Query Card */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-lg font-semibold text-text-strong mb-4 flex items-center gap-2">
            <Search className="w-5 h-5 text-accent" />
            查询知识库
          </h2>
          <div className="flex gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
              placeholder="输入查询内容..."
              className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              onClick={handleQuery}
              disabled={queryMutation.isPending || !query.trim()}
              className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-secondary rounded-lg text-white text-sm flex items-center gap-2 transition"
            >
              {queryMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Query
            </button>
          </div>

          {queryMutation.isSuccess && queryMutation.data?.success && (
            <div className="mt-4 space-y-3">
              {(queryMutation.data.data || []).map((item, idx) => (
                <div key={idx} className="bg-secondary/50 border border-border rounded-lg p-3 text-sm">
                  <div className="text-muted mb-1 text-xs">Score: {item.score?.toFixed?.(4) ?? item.score}</div>
                  <div className="text-text-strong line-clamp-4">{item.content}</div>
                </div>
              ))}
              {(queryMutation.data.data || []).length === 0 && (
                <div className="text-sm text-muted">未找到相关结果</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Document List */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-lg font-semibold text-text-strong mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-accent" />
          文档列表
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {documents.map((doc, idx) => (
            <div key={idx} className="bg-secondary/30 border border-border rounded-lg p-4 hover:border-accent/50 transition">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-text-strong truncate">{doc.filename}</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted">{doc.format}</span>
              </div>
              <div className="space-y-1 text-xs text-muted">
                <div className="flex justify-between">
                  <span>Size</span>
                  <span className="text-text-strong">{doc.size}</span>
                </div>
                <div className="flex justify-between">
                  <span>Chunks</span>
                  <span className="text-text-strong">{doc.chunkCount}</span>
                </div>
              </div>
            </div>
          ))}
          {documents.length === 0 && (
            <div className="col-span-full text-center text-sm text-muted py-12 bg-secondary/20 border border-border rounded-lg">
              暂无文档
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
