# Ouroboros Agent — Agent Guide

> **One-liner**: A self-modifying agent system where even the Agent Loop is a replaceable Skill.
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
core/               # Immutable-ish kernel
  rule-engine.ts    # The only unmodifiable floor
  tool-framework.ts # Fail-closed Tool builder + streaming executor
  db-manager.ts     # SQLite singleton + migrations (supports PG via env)
  llm-router.ts     # Unified streaming router (OpenAI / Anthropic / Gemini / local)
  self-healing.ts   # Snapshot, rollback, repair strategies
  task-scheduler.ts # Cron / interval / delayed tasks

skills/             # Everything is a Skill — including the Agent Loop
  agent-loop/       # Main agent loop (replaceable)
  browser/          # Playwright-based browser automation + Computer Use
  knowledge-base/   # RAG: ingest + embedding + vector search
  learning/         # Experience learner, pattern recognizer, evolution engine
  self-modify/      # Gateway for all self-mutations
  autonomous-evolution/ # Background daemon that auto-creates skills

extensions/im/      # IM channel plugins (Slack, Discord, Feishu, etc.)

web/                # React frontend
  src/components/   # ChatView, SystemDashboard, WorkflowStudio, etc.
  server.ts         # Monolithic HTTP API server
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

## 5. Development Workflow

- `tests/skills/browser/index.test.ts` — BrowserController unit tests
- `tests/skills/browser/computer-use.test.ts` — `computer_use` mock-LLM loop tests (19 tests)
- `tests/web/server-api.test.ts` — Gallery screenshot endpoint tests
- `tests/skills/agent-loop.test.ts` — KB auto-ingestion + progress streaming tests

---

## 4. Development Workflow

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

## 5. Adding a new API endpoint

Edit `web/server.ts`:

1. Add your route **before** the static-file fallback.
2. Use `parseBody(req, z.object({ ... }))` for POST bodies.
3. Return via `json(res, status, payload, ctx)` so metrics & context are tracked.
4. Keep handlers thin; delegate to `skills/` or `core/` modules.

---

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Database is already locked` | Delete `.ouroboros/session.lock` |
| `better-sqlite3` native crash | `npm rebuild better-sqlite3` |
| E2E 429 errors | Ensure `webServer.command` cleans `session.lock` and localhost bypass is active |
