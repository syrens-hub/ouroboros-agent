# Ouroboros（衔尾蛇）Agent — Agent Guide

> **一句话定位**：一个能自己改自己代码、自己提交 Git、自己持续进化的开源 AI 系统，目标是做「有持久身份的连续数字实体」，不是一次性脚本。
> **Immutable floor**: `core/rule-engine.ts`. Everything else can evolve.

---

## 1. Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js >= 20, TypeScript 5.9 (`tsx` for dev) |
| Backend | Native `http` server, `better-sqlite3` (SQLite), optional PostgreSQL |
| Frontend | React 19, Vite 6, Tailwind CSS 3, `@tanstack/react-query` 5 |
| Testing | Vitest (backend + frontend unit), Playwright (E2E) |
| Lint / Type | ESLint 9, `tsc --noEmit` |
| Infra | Optional Redis, optional `playwright-core` for browser skill |

---

## 2. Directory Layout

```
core/               # Immutable kernel (3 sacred files)
  rule-engine.ts    # The only unmodifiable floor
  tool-framework.ts # Fail-closed Tool builder + streaming executor
  permission-gate.ts# 3-layer permission pipeline
  db-manager.ts     # SQLite singleton + migrations (supports PG via env)
  db-adapter.ts     # Pluggable DB interface
  db-pg.ts          # PostgreSQL adapter
  config.ts         # Central configuration
  logger.ts         # Structured logging
  session-db.ts     # Barrel re-export
  index.ts          # Core barrel exports

skills/             # Everything is a Skill — including the Agent Loop
  agent-loop/       # Main agent loop (replaceable)
  autonomous-evolution/ # v9.0 Autonomous Evolution Loop: periodic scanning, auto-proposal, low-risk auto-execution, sleep on failure
  backup/           # Database backup & restore
  browser/          # Playwright-based browser automation + Computer Use
  budget-guard/     # Real-time budget tracking and automatic circuit-breaking
  checkpoint/       # Shadow-git filesystem snapshots
  hot-reload/       # File watcher for skill auto-reload
  i18n/             # 13-locale internationalization
  knowledge-base/   # RAG: ingest + embedding + vector search
  learning/         # Experience learner, pattern recognizer, evolution engine
  mcp/              # MCP connection manager + output storage + utils
  notification/     # Global notification bus (EventEmitter)
  sandbox/          # Subagent context isolation
  self-healing/     # Anomaly detection, snapshots, rollback, repair
  rate-limiter/     # Token-bucket rate limiting (API + per-user)
  self-modify/      # v8.0 Self-Modification Engine: unified diff parser, Constitution Guard, atomic write, backup/restore
  session-archiver/ # Session archiving & cleanup
  skill-versioning/ # Skill snapshot, restore, and version history
  skills-guard/     # Runtime validation of skill safety constraints
  evolution-observability/ # v8.1 Metrics & alerting (Prometheus, WebSocket, webhook) for evolution lifecycle
  evolution-dependency-graph/ # v8.2 Import scanning, topological sort, conflict detection, batch execution queue
  evolution-generator/ # v8.3 Heuristic code smell scanner & test gap analyzer; auto-proposes EvolutionProposals
  evolution-viz/    # Evolution metadata store, metrics aggregator, trend detector (rising cost, risk spikes, rollback clusters)
  evolution-memory/ # Records evolution outcomes into Knowledge Base for RAG-guided future decisions
  meta-evolution/   # v9.1 Historical outcome analysis & auto-tuning of system parameters (thresholds, freeze periods)
  smart-cache/      # LRU cache with TTL and size eviction
  task-scheduler/   # Cron / interval / delayed tasks with retries
  telemetry/        # OpenTelemetry spans, metrics, OTLP exporter
  webhooks/         # Webhook registration & delivery

extensions/im/      # IM channel plugins (Slack, Discord, Feishu, etc.)

web/                # React frontend + HTTP API server
  src/components/   # ChatView, SystemDashboard, WorkflowStudio, etc.
  server.ts         # Monolithic HTTP API server
  ws-server.ts      # WebSocket for real-time chat
  routes/           # REST API handlers
```

---

## 3. Browser & Computer Use

### 3.1 Available Browser Tools

All browser tools live in `skills/browser/index.ts` and are registered automatically in `web/runner-pool.ts`.

| Tool | Description |
|------|-------------|
| `browser_launch` | Start Playwright Chromium |
| `browser_close` | Close the browser |
| `browser_navigate` | Navigate a page to a URL |
| `browser_click` | Click an element by CSS selector |
| `browser_fill` | Fill an input by CSS selector |
| `browser_scroll` | Scroll the page |
| `browser_screenshot` | Save a PNG screenshot to `~/.ouroboros/browser-screenshots/` |
| `browser_screenshot_base64` | Return a `data:image/png;base64` data URL for vision LLMs |
| `browser_get_elements` | Extract interactive elements with index, tag, text, and selector hints |
| `browser_extract` | Extract visible text from the page |
| `computer_use` | **Vision-Action Loop**: autonomously operate a browser using a vision LLM |

### 3.2 Computer Use (`computer_use`)

`computer_use` closes the loop between Playwright screenshots and a Vision LLM.

**How it works:**
1. Navigates to `startUrl`
2. Takes a base64 screenshot
3. **Extracts interactive elements** from the page and injects them into the prompt
4. Sends screenshot + element list to the configured vision LLM
5. Parses the LLM response into one of: `click`, `type`, `scroll`, `navigate`, `done`
6. Executes the action via Playwright
7. **Streams progress events** back to the Web UI after every step
8. Repeats up to `maxSteps` (default 10) until the task is complete

**Input schema:**
```json
{
  "goal": "Search for Kimi on Google",
  "startUrl": "https://google.com",
  "maxSteps": 10
}
```

**Output schema:**
```json
{
  "success": true,
  "goal": "Search for Kimi on Google",
  "summary": "Typed 'Kimi' and submitted the search.",
  "stepsTaken": 3,
  "finalUrl": "https://www.google.com/search?q=Kimi",
  "finalScreenshotPath": "/Users/.../.ouroboros/browser-screenshots/...",
  "finalScreenshotUrl": "/api/gallery/screenshots/....png",
  "history": [
    "navigate -> https://google.com",
    "type -> textarea[name='q']: Kimi",
    "click -> input[name='btnK']",
    "done -> Typed 'Kimi' and submitted the search."
  ]
}
```

### 3.3 Real-time Progress Streaming

While `computer_use` is running, it emits `ToolProgressEvent`s via `ctx.reportProgress`. The Agent Loop polls these events during tool execution and yields them over WebSocket. Each progress event includes:

- `step` / `totalSteps`
- `message` (e.g. "Click #submit")
- `detail.screenshotUrl` — a mid-step screenshot saved to `~/.ouroboros/browser-screenshots/`

The Web UI renders progress inside a dedicated `ComputerUseCard` that appears as soon as the tool starts:

- Auto-expands and shows a step timeline
- Each step displays its message and a thumbnail screenshot
- When the tool finishes, the card transitions from "running" to "completed" and shows the final screenshot

### 3.4 Feishu / IM Integration

When `computer_use` is invoked via Feishu:

1. The assistant's natural-language summary is sent as a text message
2. The final screenshot is automatically read from disk and sent via `sendMedia` as an image message

This works because the Feishu handler (`web/server.ts`) detects `computer_use` `tool_result` events and queues `finalScreenshotPath` for image upload.

### 3.5 Screenshot Auto-Cleanup

The `BrowserController` automatically cleans up the `~/.ouroboros/browser-screenshots/` directory after every screenshot save:

- **Max count**: keeps only the newest `screenshotMaxCount` files (default **200**)
- **Max age**: deletes files older than `screenshotMaxAgeMs` (default **24 hours**)

You can customize these limits when constructing `BrowserController`:

```ts
new BrowserController({ screenshotMaxCount: 500, screenshotMaxAgeMs: 48 * 60 * 60 * 1000 });
```

This prevents unbounded disk growth, especially since `computer_use` saves both intermediate and final screenshots.

### 3.6 Security Guards

- `file://` URLs are always blocked
- Localhost URLs with backend ports (`8080`, `3000`, `5000`, `8000`, `9000`) are blocked
- Mid-loop navigation to disallowed URLs throws an error
- Each vision LLM call is capped at 30 seconds
- Pages are closed on errors to prevent resource leaks

### 3.7 Web UI Display

When `computer_use` returns, the frontend (`ChatView.jsx`) detects the result structure and renders a dedicated `ComputerUseCard` instead of raw JSON:

- Collapsible card showing goal, summary, and step count
- Full action history list
- Click-to-zoom final screenshot

### 3.8 Auto-Ingestion into Knowledge Base

Successful `computer_use` trajectories are automatically converted to Markdown and ingested into the `KnowledgeBase` by the Agent Loop (`skills/agent-loop/index.ts`). This means:

- Browser automation experience is vectorized and stored
- Future similar queries trigger RAG recall
- The agent learns "how to operate X website" over time

### 3.9 Auto-Generation of Browser Skills

The Autonomous Evolution Daemon (`skills/autonomous-evolution/index.ts`) is primed to recognize successful `computer_use` trajectories. When it detects one, it can generate a dedicated browser skill whose `index.ts` imports `BrowserController` from `../../skills/browser/index.ts` and replays the learned sequence.

## 4. Memory System Optimizations

### 4.1 HNSW Vector Index (usearch)

`skills/knowledge-base/vector-store.ts` now uses `usearch` HNSW index for approximate nearest neighbor search instead of O(N) brute-force linear scan:

- **Lazy loading**: the HNSW index is built from SQLite on the first `search()` or `add()` call
- **Global index**: one index holds vectors from all sessions; results are post-filtered by `sessionId`
- **Persistent fallback**: if the HNSW index returns insufficient results for a session, it falls back to brute-force SQL scan
- **Sync on write/delete**: `add`, `addMany`, `delete`, and `clear` all keep the HNSW index in sync with SQLite

### 4.2 Embedding LRU Cache

`skills/knowledge-base/embedding-service.ts` caches embedding results in a 1000-entry LRU cache:

- Repeated queries (e.g. Active Memory injecting the same context every turn) return instantly
- Saves API tokens/costs for OpenAI and MiniMax providers
- Also benefits the new Xenova local model by avoiding redundant ONNX inference

### 4.3 Active Memory via ContextManager

`skills/agent-loop/index.ts` no longer pushes raw `system` messages for memory. Instead:

- Memory hits (`memory_layers` + `knowledgeBase`) are converted into `InjectionItem`s
- They are passed to `ContextManager.buildContext()` alongside `opts.contextInjections`
- `ContextInjector` tracks injection history, so `maxFrequency: 1` prevents the same memory block from being injected on consecutive turns (deduplication)
- **Adaptive topK**: based on the current `contextBudget`:
  - `< 4000` tokens → 1 memory item, 256 max injection tokens
  - `< 8000` tokens → 3 items, 512 max tokens
  - `≥ 8000` tokens → 5 items, 1024 max tokens

### 4.4 Local Semantic Embeddings (Xenova / MiniLM)

The default embedding provider has been upgraded from 256-dim character trigrams to **Xenova/all-MiniLM-L6-v2** (384-dim, ONNX runtime):

- `runner-pool.ts` global `KnowledgeBase` uses `provider: "xenova"`
- `ingest_document` and `query_knowledge` tools also default to `"xenova"`
- The old `provider: "local"` (trigram) is still available as a fallback
- First use downloads the model (~80MB) to `~/.cache/huggingface/`; subsequent calls are local-only

### 4.5 Knowledge Base Auto-Cleanup

`KnowledgeBase` automatically prunes documents after every successful `ingestDocument`:

- **TTL**: documents older than `documentMaxAgeMs` (default **30 days**) are deleted
- **Per-session cap**: keeps only the newest `maxDocumentsPerSession` docs (default **100**)
- **Global cap**: keeps only the newest `maxDocumentsGlobal` docs (default **1000**)
- **Cascade delete**: removing a document also deletes its `kb_chunks` and `vector_embeddings` entries (and updates the HNSW index)

### 4.6 Memory System Test Coverage

- `tests/skills/knowledge-base/vector-store.test.ts` — HNSW + brute-force fallback (4 tests)
- `tests/skills/knowledge-base/embedding-service.test.ts` — local, OpenAI, Minimax, Xenova mocked (5 tests)
- `tests/skills/knowledge-base/index.test.ts` — ingest, query, list/delete, auto-cleanup (4 tests)

- `tests/skills/browser/index.test.ts` — BrowserController unit tests
- `tests/skills/browser/computer-use.test.ts` — `computer_use` mock-LLM loop tests (19 tests)
- `tests/web/server-api.test.ts` — Gallery screenshot endpoint tests
- `tests/skills/agent-loop.test.ts` — KB auto-ingestion + progress streaming tests

---

## 5. Security Notes

### Self-Modification Demo Mode
By default, the agent **denies all self-modification requests** to prevent accidental or malicious mutations. To enable the interactive demo where low/medium risk changes can be approved:

```bash
export OUROBOROS_DEMO_MODE=1
npx tsx main.ts
```

High/critical risk modifications are still denied in demo mode and require a real confirmation callback implementation.

### API Authentication
All `/api/*` endpoints (except health/readiness/metrics probes) are protected when `WEB_API_TOKEN` is set. The built-in React frontend automatically receives the token via an injected script tag. For headless or third-party clients, include the token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer $WEB_API_TOKEN" http://localhost:8080/api/sessions
```

### Skill Version Control
Every mutation to a skill (via `self_modify` or `write_skill`) automatically creates a version snapshot under `.ouroboros/skill-versions/<skillName>/<timestamp>/`. You can list, restore, and prune versions via tools or API:

| Tool | Purpose |
|------|---------|
| `list_skill_versions` | Show archived versions of a skill |
| `restore_skill_version` | Roll back a skill to a previous snapshot |
| `prune_skill_versions` | Retain only the N most recent versions |

### Prompt Defense
The system sanitizes user input, file contents, and tool results before sending them to the LLM. It detects:
- Direct injection patterns (`ignore previous instructions`, `system override`, etc.)
- Chinese injection patterns
- Base64 and URL-encoded payloads
- System prompts hidden inside markdown code blocks
- Meta delimiter confusion (`---`, `<<<`, `>>>`)

### OpenAPI Documentation
An auto-generated OpenAPI 3.0.3 spec is available at:

```bash
curl http://localhost:8080/api/openapi.json
```

It includes all registered tools (with Zod-derived JSON schemas) and the core HTTP endpoints.

## 6. Architecture Changelog

### v9.1 Meta-Evolution
`skills/meta-evolution/index.ts` analyzes historical evolution outcomes to recommend and apply system parameter tuning:
- Queries `evolution_versions` + `evolution_executions` to compute success rates by risk bucket
- Recommends adjustments to `autoApproveRiskThreshold`, `consensusSkipThreshold`, `freezePeriodHours`
- Persists applied tuning to `meta_evolution_tuning` table
- Registered as a daily cron task in `web/server.ts`

### v9.0 Autonomous Evolution Loop
`skills/autonomous-evolution/index.ts` replaces the old daemon with a stateful loop:
- **States**: `idle` → `scanning` → `proposing` → `executing` → `idle` | `sleeping`
- Periodically runs `runAutoReview()` (from `evolution-generator`) to find code smells / test gaps
- Auto-approves proposals with `riskScore < 20` via the Hybrid Approval Generator
- Executes approved evolutions through the Evolution Orchestrator pipeline
- Enters sleep mode after `maxConsecutiveFailures` (default 3), emitting `autonomous:sleep` event
- Integrates with `web/runner-pool.ts` (`startDaemon` / `stopDaemon`) and REST API (`web/routes/handlers/daemon.ts`)

### v8.3 LLM-Driven Evolution Generator
`skills/evolution-generator/index.ts` provides heuristic code review without requiring an LLM call:
- `scanCodeSmells()`: detects magic numbers, long functions (>50 lines), deep nesting (>4), missing return types
- `analyzeTestGaps()`: finds source files without corresponding `.test.ts`
- `runAutoReview()`: runs both scanners and returns the highest-priority `EvolutionProposal`

### v8.2 Evolution Dependency Graph
`skills/evolution-dependency-graph/index.ts` enables batched evolution execution:
- `scanFileDependencies()`: regex-based import scanner
- `DependencyGraph.topoSort()`: Kahn's algorithm topological sort for execution ordering
- `detectConflicts()`: file overlap + order violation detection across proposals
- `ExecutionQueue`: batch queue with `enqueue`, `getNextBatch`, `markExecuted`

### v8.1 Evolution Observability
`skills/evolution-observability/index.ts` exposes metrics and lifecycle alerts:
- Subscribes to EventBus events: `evolution:proposed`, `evolution:executed`, `evolution:failed`, `evolution:rolledBack`
- `formatPrometheusMetrics()`: renders `evolution_total_*` counters and gauges
- `getMetricsSnapshot()`: JS object for dashboards
- Broadcasts notifications via WebSocket

### v8.0 Self-Modification Engine
`skills/self-modify/index.ts` rewritten with 4 safety layers:
- **Constitution Guard**: blocks mutations to `core/` and immutable paths (`core/rule-engine.ts`, `core/tool-framework.ts`, `core/permission-gate.ts`, `core/config.ts`, `identity.md`, `BIBLE.md`)
- **Syntax Validation**: runs `tsc --noEmit` on mutated TS/JS files before applying
- **Atomic Write**: writes to temp file then `fs.rename` for crash safety
- **Backup Snapshot**: `createBackup()` / `restoreBackup()` with full file tree rollback
- Supports unified diff (`parseUnifiedDiff` / `applyHunks`), full content replacement, and dry-run mode
- Canary test hook: auto-rolls back if post-mutation canary fails

### Stability Fixes (v9.x release)
- `evolution-viz/trend-detector.ts`: fixed rising-cost detection bug (record sort order + midpoint split)
- `evolution-viz/metadata-store.ts`: fixed `getDb()` to create `DbDir` (not just `OuroborosDir`), resolving "Cannot open database because the directory does not exist" in parallel test runs
- `tests/web/ws-server.test.ts`: resolved flaky 10s timeout by rewriting tests to use isolated `new WebSocketServer({ port: 0 })` instances per test, completely avoiding the module-level `attachWebSocket()` singleton and `notificationBus` listener leakage across forked test workers
- `web/ws-server.ts`: fixed duplicate `ws.on("pong", ...)` registration; `closeWebSocket()` now properly removes the `notificationBus` listener to prevent leaks
- `tests/skills/evolution-memory/evolution-memory.test.ts`: fixed `beforeEach` to initialize `KnowledgeBase` before running `DELETE FROM` statements on lazy-created tables
- `skills/evolution-version-manager/index.ts`: fixed `prefer-const` lint error

### Per-Session ToolPool Isolation
`web/runner-pool.ts` no longer shares a single mutable `globalPool` across all sessions.
- Each `AgentLoopRunner` receives its own `ToolPool` cloned from the global set at creation time.
- `reloadSkillTools()` propagates new/updated tools to both `globalPool` and all active session pools, ensuring hot-loaded skills remain available without restarting runners.
- This prevents session cross-contamination when skills are dynamically generated or modified.

### Unified Error-Handling Strategy
A consistent fail-open / fail-closed model has been adopted across `core/`:
- **Security-sensitive code** (Rule Engine, permission gates, webhook signatures, fingerprint checks) **must fail-closed** — any exception results in denial/blocking and is logged via `logger.warn`.
- **Infrastructure probes** (table existence, process liveness, schema extraction) may fail-open but are logged via `logger.info`.
- **Cleanup / listener / close operations** silently ignore errors via `logger.debug` using `safeIgnore()`.
- New helpers live in `core/safe-utils.ts`: `safeFailClosed`, `safeFailClosedAsync`, `safeFailOpen`, `safeFailOpenAsync`, and `safeIgnore`.

#### Notable security fixes
- `core/rule-engine.ts`: `normalizePath()` previously caught exceptions and returned the raw input, allowing potential path-traversal bypass. It now **throws** on unresolvable paths.
- `core/repositories/modification.ts`: `isModificationFingerprintRecent()` previously returned `false` on DB failure, allowing duplicate modifications. It now returns `true` (treat as recent / block execution) to fail-closed.

## 7. Development Workflow

### Required checks before committing

```bash
# 1. Type check (zero errors)
npm run typecheck

# 2. Lint (zero errors, minimize warnings)
npm run lint

# 3. Backend unit tests
npm test

# 4. Frontend unit tests
cd web && npm test

# 5. Production build
cd web && npm run build
```

---

## 8. Adding a new API endpoint

Edit `web/server.ts`:

1. Add your route **before** the static-file fallback.
2. Use `parseBody(req, z.object({ ... }))` for POST bodies.
3. Return via `json(res, status, payload, ctx)` so metrics & context are tracked.
4. Keep handlers thin; delegate to `skills/` or `core/` modules.

---

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Database is already locked` | Delete `.ouroboros/session.lock`. In tests, stale `.ouroboros/vitest-*/session.lock` files from crashed fork workers can also trigger this — remove them before running the suite |
| `better-sqlite3` native crash | `npm rebuild better-sqlite3` |
| E2E 429 errors | Ensure `webServer.command` cleans `session.lock` and localhost bypass is active |
| Vitest parallel DB lock (`vitest-*/session.lock`) | Known limitation with `pool: "forks"` — stale lock files may be left behind when a fork worker crashes or is killed. Run `rm -rf .ouroboros/vitest-*` before `npx vitest run` if you see `kill ESRCH` or lock errors |
