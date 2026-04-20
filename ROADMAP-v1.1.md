# Ouroboros Agent v1.1 功能规划 — 智能文档与知识管理增强

> 基于用户功能需求与现有系统架构的映射分析

---

## 架构映射总览

| 需求领域 | 现有能力 | 契合度 | 实现策略 |
|---------|---------|--------|---------|
| 深层语义分析 | `skills/knowledge-base/` (RAG), `skills/engraph/` (图搜索) | ⭐⭐⭐⭐⭐ | 新建 `skills/nlp-deep-analysis/` |
| 复杂格式解析 | `skills/browser/`, `skills/pdf-generator/` | ⭐⭐⭐⭐ | 新建 `skills/document-parser/` |
| 多端实时同步 | `web/ws-server.ts` (WebSocket + Redis Pub/Sub) | ⭐⭐⭐⭐⭐ | 扩展 `web/src/` + 后端 API |
| 细粒度权限 | `core/permission-engine.ts` (4层权限) | ⭐⭐⭐⭐⭐ | 扩展 core 层 + web 中间件 |
| 知识图谱 | `skills/knowledge-base/`, `skills/engraph/` | ⭐⭐⭐⭐⭐ | 新建 `skills/knowledge-graph/` |
| 外部工具联动 | `skills/notion-skill/` | ⭐⭐⭐⭐⭐ | 新建 `skills/obsidian-bridge/`, `skills/notion-sync/` |
| 性能优化 | `core/smart-cache.ts`, `core/llm-cache-wrapper.ts` | ⭐⭐⭐⭐ | 扩展缓存层 |
| 可靠性 | `core/llm-resilience.ts`, `skills/self-healing/` | ⭐⭐⭐⭐⭐ | 扩展现有韧性框架 |
| 监控告警 | `skills/telemetry/` (OTel), `core/disk-monitor.ts` | ⭐⭐⭐⭐⭐ | 集成 Prometheus + Grafana |

---

## P0 — 核心骨架（4 周）

### 1. 深层语义分析引擎 `skills/nlp-deep-analysis/`

**目标**: 实现逻辑链梳理、观点挖掘、上下文推理

**技术方案**:
```
skills/nlp-deep-analysis/
├── index.ts              # Tool exports: analyzeLogicChain, extractViewpoints, inferContext
├── logic-chain.ts        # LLM prompt + parser for premise→argument→conclusion
├── viewpoint-miner.ts    # Stance detection + key claim extraction
├── context-inferencer.ts # Co-reference resolution + implicit premise recovery
├── types.ts              # AnalysisResult, LogicNode, Viewpoint
└── SKILL.md
```

**Prompt 设计** (基于现有 LLM 调用模式):
```typescript
// 复用 core/llm-router.ts 的多供应商路由
const result = await llmRouter.generate({
  system: "你是一个结构化语义分析专家。将用户文本解析为逻辑链 JSON。",
  prompt: buildLogicChainPrompt(text),
  responseFormat: "json",
  temperature: 0.2,
});
```

**与现有系统集成**:
- 输入: 接收 `skills/knowledge-base/` 的文档文本
- 输出: 结构化 JSON 存入 `core/db-manager.ts` (新增 `analysis_results` 表)
- UI: Web 端 `/api/analysis` 路由返回结果

**工作量**: ~3 天

---

### 2. 文档解析引擎 `skills/document-parser/`

**目标**: OCR + Mathpix + 图表语义提取

**技术方案**:
```
skills/document-parser/
├── index.ts              # Tool exports: parsePDF, parseImage, extractFormulas
├── ocr-adapter.ts        # 阿里云 / 百度 OCR API 封装
├── mathpix-adapter.ts    # Mathpix API 封装
├── chart-extractor.ts    # 图表 → 结构化数据 (CSV / JSON)
├── chunk-parser.ts       # 大文件分片解析 (对应性能优化需求)
└── SKILL.md
```

**API 集成示例**:
```typescript
// 阿里云 OCR
const ocrResult = await callAliyunOCR(imageBuffer);
// Mathpix
const latex = await callMathpix(imageBuffer);
// 图表提取 (基于现有 browser/ Playwright 截图能力)
const chartData = await extractChartData(pdfPageImage);
```

**工作量**: ~5 天

---

### 3. 细粒度文档权限系统

**目标**: view / comment / edit / manage 四级权限

**技术方案**:

**Core 层扩展** (`core/permission-engine.ts`):
```typescript
// 新增文档权限类型
export type DocPermission = "view" | "comment" | "edit" | "manage";

export interface DocPermissionRule {
  userId: string;
  docId: string;
  permission: DocPermission;
  grantedBy: string;
  grantedAt: number;
  expiresAt?: number;
}

export function checkDocPermission(
  userId: string,
  docId: string,
  required: DocPermission,
  db: DbAdapter
): boolean {
  const levels = { view: 1, comment: 2, edit: 3, manage: 4 };
  const row = db.prepare(
    "SELECT permission FROM doc_permissions WHERE user_id = ? AND doc_id = ?"
  ).get(userId, docId) as { permission: DocPermission } | undefined;
  return row ? levels[row.permission] >= levels[required] : false;
}
```

**Web 中间件** (`web/routes/lib/auth.ts`):
```typescript
export function requireDocPermission(perm: DocPermission) {
  return async (req: IncomingMessage, res: ServerResponse, ctx: ReqContext) => {
    const docId = extractDocId(req);
    const userId = ctx.userId;
    if (!checkDocPermission(userId, docId, perm, getDb())) {
      json(res, 403, { success: false, error: { message: "Insufficient permission" } }, ctx);
      return false;
    }
    return true;
  };
}
```

**数据库迁移**:
```sql
CREATE TABLE doc_permissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  permission TEXT NOT NULL CHECK(permission IN ('view','comment','edit','manage')),
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  UNIQUE(user_id, doc_id)
);
CREATE INDEX idx_doc_permissions_doc ON doc_permissions(doc_id);
```

**工作量**: ~4 天

---

### 4. WebSocket 多端同步增强

**目标**: 批注 / 笔记跨端实时同步，解决数据冲突

**现有基础**: `web/ws-server.ts` 已支持 Redis Pub/Sub 多实例广播

**技术方案**:

**后端** (`web/ws-server.ts` 扩展):
```typescript
// 新增消息类型
interface SyncMessage {
  type: "annotation" | "note" | "cursor";
  docId: string;
  userId: string;
  payload: unknown;
  timestamp: number;
  version: number; // 用于冲突解决
}

// CRDT 简化版：last-write-wins + 版本向量
function resolveConflict(local: SyncMessage, remote: SyncMessage): SyncMessage {
  if (local.version === remote.version) {
    return local.timestamp > remote.timestamp ? local : remote;
  }
  return local.version > remote.version ? local : remote;
}
```

**前端** (`web/src/` 新增):
```
web/src/
  hooks/
    useSync.ts         # WebSocket 连接管理 + 消息处理
  components/
    AnnotationPanel.tsx  # 批注侧边栏
    NoteSidebar.tsx      # 笔记侧边栏
  stores/
    syncStore.ts       # Zustand store for optimistic updates
```

**工作量**: ~5 天

---

## P1 — 功能完善（3 周）

### 5. 知识图谱 `skills/knowledge-graph/`

**目标**: 基于文本实体/关系生成可视化图谱，支持拖拽编辑

**技术方案**:
```
skills/knowledge-graph/
├── index.ts              # Tool exports: generateGraph, updateGraph
├── entity-extractor.ts   # NER + 实体链接
├── relation-builder.ts   # 关系抽取 (基于 engraph/ 的 2-hop CTE)
├── graph-store.ts        # 图数据存储 (复用 engraph/ 的 relations 表)
├── export-viz.ts         # 导出为 Cytoscape.js / D3 格式
└── SKILL.md
```

**前端可视化** (`web/src/components/KnowledgeGraph.tsx`):
- 使用 `react-cytoscapejs` 或 `@xyflow/react`
- 实时从 `/api/knowledge-graph/:docId` 获取数据

**工作量**: ~5 天

---

### 6. Obsidian / Notion 桥接

**目标**: 批注/笔记一键同步到外部工具

**技术方案**:
```
skills/obsidian-bridge/
├── index.ts              # Tool exports: syncToObsidian, syncFromObsidian
├── vault-adapter.ts      # Obsidian vault 文件系统操作
├── markdown-converter.ts # 结构化笔记 → Markdown
└── SKILL.md

skills/notion-sync/
├── index.ts              # Tool exports: syncToNotion, syncFromNotion
├── page-adapter.ts       # Notion Page API 封装
└── SKILL.md
```

**工作量**: ~4 天

---

### 7. 性能优化套件

**目标**: 分片解析、语义缓存、性能基准

**技术方案**:

**A. 大文件分片解析** (`skills/document-parser/chunk-parser.ts`):
```typescript
export async function* parsePDFChunks(
  filePath: string,
  chunkSize: number = 50
): AsyncGenerator<{ page: number; text: string; progress: number }> {
  const pdf = await pdfjs.getDocument(filePath).promise;
  const total = pdf.numPages;
  for (let i = 1; i <= total; i += chunkSize) {
    const pages = await Promise.all(
      range(i, Math.min(i + chunkSize - 1, total))
        .map(p => pdf.getPage(p).then(page => page.getTextContent()))
    );
    for (const [idx, content] of pages.entries()) {
      yield { page: i + idx, text: content.items.map((x: any) => x.str).join(" "), progress: (i + idx) / total };
    }
  }
}
```

**B. 语义缓存** (`core/semantic-cache.ts` 扩展):
```typescript
// 新增：分析结果缓存
export async function getCachedAnalysis(text: string, analyzer: () => Promise<unknown>) {
  const hash = createHash("sha256").update(text).digest("hex");
  const cached = semanticCache.get(hash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }
  const result = await analyzer();
  semanticCache.set(hash, { result, timestamp: Date.now() });
  return result;
}
```

**C. 性能基准** (`tests/perf/` 新增):
```
tests/perf/
├── pdf-parse.bench.ts    # Vitest benchmark
├── api-latency.bench.ts  # API 端点延迟测试
└── locust/
    ├── locustfile.py     # Locust 压测脚本
    └── README.md
```

**工作量**: ~4 天

---

## P2 — 可靠性 + 监控（2 周）

### 8. 异常降级策略

**目标**: NLP/OCR 服务不可用时优雅降级

**技术方案** (扩展 `core/llm-resilience.ts`):
```typescript
export async function resilientAnalyze(text: string): Promise<AnalysisResult> {
  // 1. 尝试 LLM 深度分析
  const llmResult = await tryWithFallback(
    () => deepAnalyze(text),
    { maxRetries: 2, fallback: () => ruleBasedSummary(text) }
  );
  if (llmResult.success) return llmResult.data;

  // 2. 降级：规则化摘要
  logger.warn("LLM analysis failed, falling back to rule-based summary", { textLength: text.length });
  return ruleBasedSummary(text);
}
```

**工作量**: ~2 天

---

### 9. 监控告警 (Prometheus + Grafana)

**目标**: 核心指标可视化 + 异常告警

**技术方案**:

**A. 指标暴露** (`web/routes/lib/metrics.ts` 扩展):
```typescript
// 已有 HTTP 请求指标，新增：
- nlp_analysis_duration_seconds
- nlp_analysis_total
- ocr_requests_total
- ocr_errors_total
- doc_parse_duration_seconds
- ws_sync_latency_seconds
- doc_permission_checks_total
```

**B. Prometheus 配置** (`deploy/prometheus.yml`):
```yaml
scrape_configs:
  - job_name: 'ouroboros-agent'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'
```

**C. Grafana Dashboard** (`deploy/grafana/dashboards/ouroboros.json`):
- 系统健康面板
- API 延迟热力图
- LLM 调用成功率
- 文档处理吞吐量

**D. 告警规则** (`deploy/prometheus/alerts.yml`):
```yaml
groups:
  - name: ouroboros
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "Ouroboros error rate is high"
```

**工作量**: ~4 天

---

## 数据库 Schema 变更

```sql
-- 分析结果表
CREATE TABLE analysis_results (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('logic_chain','viewpoints','context')),
  result_json TEXT NOT NULL,
  confidence REAL,
  created_at INTEGER NOT NULL,
  model TEXT,
  FOREIGN KEY (doc_id) REFERENCES documents(id)
);

-- 文档表（新增）
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  content_type TEXT DEFAULT 'text', -- text | pdf | image
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 批注表
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  range_start INTEGER,
  range_end INTEGER,
  content TEXT NOT NULL,
  type TEXT DEFAULT 'comment', -- comment | highlight | note
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER DEFAULT 1,
  FOREIGN KEY (doc_id) REFERENCES documents(id)
);

-- 笔记表
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  doc_id TEXT,
  user_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  tags TEXT, -- JSON array
  source_position TEXT, -- "doc_id:page:paragraph"
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 知识图谱节点
CREATE TABLE kg_nodes (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL, -- entity | concept | event
  properties TEXT, -- JSON
  x REAL, y REAL -- 可视化坐标
);

-- 知识图谱边
CREATE TABLE kg_edges (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  confidence REAL
);
```

---

## 实施路线图

| 周 | P0 | P1 | P2 |
|---|-----|-----|-----|
| 1 | ① 语义分析引擎 (3d) | | |
| 1 | ② 文档解析引擎 (2d) | | |
| 2 | ② 文档解析引擎 (3d) | | |
| 2 | ③ 权限系统 (4d) | | |
| 3 | ④ WebSocket 同步 (5d) | | |
| 4 | 收尾 + 集成测试 | ⑤ 知识图谱 (3d) | |
| 5 | | ⑤ 知识图谱 (2d) | |
| 5 | | ⑥ Obsidian/Notion (4d) | |
| 6 | | ⑦ 性能优化 (4d) | |
| 7 | | | ⑧ 降级策略 (2d) |
| 7 | | | ⑨ 监控告警 (4d) |
| 8 | 全链路集成测试 + 性能压测 | | |

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| LLM API 成本过高 | 语义分析频繁调用 LLM | 引入语义缓存 + 批量分析 |
| OCR/ Mathpix API 限流 | 文档解析失败 | 本地 OCR 备选 (Tesseract) + 队列限流 |
| WebSocket 并发过高 | 服务器内存溢出 | Redis Pub/Sub 横向扩展 |
| 权限模型过于复杂 | 性能下降 | 缓存权限检查结果 (TTL 5min) |
| 知识图谱数据量大 | 查询慢 | 预计算 + 图数据库 (Neo4j 可选) |

---

## 下一步建议

1. **立即开始**: P0-① 语义分析引擎（与现有 knowledge-base / engraph 集成最顺畅）
2. **并行启动**: P0-③ 权限系统（数据库迁移需要尽早完成，避免后续 schema 冲突）
3. **设计先行**: WebSocket 同步的冲突解决策略（CRDT vs LWW）需要前端/后端对齐

是否需要我立即开始实现 P0-① 语义分析引擎？
