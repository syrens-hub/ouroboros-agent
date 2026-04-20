# ouroboros-agent

## 1.0.0-rc.1

### Release Candidate — Coverage Sprint & Production Hardening

- **Test Coverage**: statements 77.75% → **80.24%**, branches 76.06% → **77.54%**, functions 80.43% → **82.54%**
- **ESLint Toolchain**: fixed `eslint@9` + `@eslint/eslintrc` crash caused by `ajv@8` dedupe; added `overrides.ajv: ^6.14.0`
- **Marketplace**: fixed `installSkill()` signature to pass `force` parameter, resolving upgrade/downgrade test failures
- **Hook System**: converted `registerBuiltins()` from `require()` to dynamic `import()` for ESM compatibility
- **New Tests**:
  - `tests/core/llm-metrics.test.ts` — rolling-window metric overflow & empty-state branches
  - `tests/skills/telemetry/timed-query.test.ts` — slow-query threshold branches
  - `tests/skills/personality/anchor-store.test.ts` — anchor CRUD & category filter branches
  - `tests/skills/rate-limiter/index.test.ts` — Redis-backed rate-limit branches
  - `tests/skills/engraph/graph-lane.test.ts` — graph search & error-handling branches
  - `tests/web/routes/handlers/browser.test.ts` — navigate/click/fill error paths
  - `tests/skills/marketplace.test.ts` — version comparison & force-install logic
  - `tests/core/hook-system.test.ts` — timeout/throw/discovery coverage
  - `tests/skills/self-healing/canary-runner.test.ts` — canary rollback logic
- **TypeScript**: resolved all tsc errors; fixed `TaskOptions` strictness in scheduler tests
- **ESLint Warnings**: 63 → 25 (cleaned unused imports across 10+ modules)
- **Package Metadata**: bumped version to `1.0.0-rc.1`, added `license`, `main`, `bin`, `files`, `keywords`

## 0.8.0

### Minor Changes

- v9.0-9.2: Autonomous Evolution, Meta-Evolution & Cross-Instance Sync

  ### v9.0: Autonomous Evolution Loop

  - **Autonomous Evolution Loop** (`skills/autonomous-evolution/index.ts`): 24/7 self-improvement without human intervention.
    - `AutonomousEvolutionLoop` runs a configurable cycle (default 1h):
      1. `runAutoReview()` scans for smells/gaps
      2. Generates `EvolutionProposal` and submits to safety pipeline
      3. Auto-executes if risk < `autoApproveRiskThreshold`
      4. Records outcome to evolution memory
    - **Sleep mechanism**: after `maxConsecutiveFailures` (default 3), enters sleep for 24h to avoid runaway loops
    - **State persistence**: SQLite table `autonomous_evolution_state` survives restarts
    - Auto-starts alongside the execution daemon at server boot

  ### v9.1: Meta-Evolution

  - **Meta-Evolution Tuner** (`skills/meta-evolution/index.ts`): The system improves its own evolution rules.
    - `analyzeMetaEvolution()`: analyzes historical outcomes and recommends parameter adjustments
      - Low auto-approve success rate → lower `autoApproveRiskThreshold`
      - High regression rate → switch to full test suite
      - High delayed approval success → widen auto window
    - `applyTuning()`: records applied adjustments for audit
    - Registered as a daily cron task (`0 1 * * *`)

  ### v9.2: Cross-Instance Knowledge Sharing

  - **Evolution Sync** (`skills/evolution-sync/index.ts`): Shares successful patterns across Ouroboros instances.
    - `exportSuccessfulEvolutions()`: queries the version DB and packages high-success-rate patterns into `SyncManifest`
    - `importTemplates()`: persists remote templates into `evolution_templates` table
    - `syncFromDirectory()`: filesystem-based sync for air-gapped environments
    - `fetchRemoteManifest()`: HTTP pull for networked instances

  ### Stability & Production Hardening

  - Fixed `evolution-viz` trend-detector flaky test: `logEvolution` now respects caller-provided `createdAt` instead of overwriting with `Date.now()`
  - Fixed `ws-server` auth flaky test: tests temporarily clear `apiToken` to avoid `.env` interference
  - Updated `daemon.test.ts` and `runner-pool.ts` to use new `AutonomousEvolutionLoop` interface
  - Added `autonomous:sleep` to `HookEventType` for event-bus compatibility

## 0.7.0

### Minor Changes

- v8.1-8.3: Evolution Observability, Dependency Graph & LLM-Driven Generator

  ### v8.1: Evolution Observability & Alerting

  - **Evolution Observability** (`skills/evolution-observability/index.ts`): Central hub for evolution lifecycle telemetry.
    - `registerEvolutionObservability(targets?)`: hooks into all 5 evolution events (`proposed`, `approved`, `executed`, `failed`, `rolledBack`).
    - **Webhook delivery**: sends signed POST payloads to configurable URLs (Slack/Feishu/generic) on matching events.
    - **WebSocket broadcast**: pushes all events through `notificationBus` → WebSocket clients in real time.
    - **Prometheus metrics**: `formatPrometheusMetrics()` exports counters/gauges (`evolution_total_*`, `evolution_pending_approvals`, `evolution_active_executions`, `evolution_avg_execution_time_ms`).
    - `GET /api/evolution/live-metrics` — JSON snapshot.
    - `GET /api/evolution/prometheus` — Prometheus text format.
    - Auto-registered at server startup alongside executor daemon and feedback loop.

  ### v8.2: Evolution Dependency Graph

  - **Dependency Graph** (`skills/evolution-dependency-graph/index.ts`): Understands code-level relationships between evolving files.
    - `scanFileDependencies(filePath)`: lightweight regex-based import scanner (supports ESM `import` and CJS `require`).
    - `DependencyGraph.topoSort(files)`: topological ordering respecting import direction (dependencies before dependents).
    - `detectConflicts(proposals)`: detects **file overlap** (same file in multiple evolutions) and **order violations** (dependent appears before dependency in batch).
    - `ExecutionQueue`: manages batched evolutions with conflict screening and status tracking.

  ### v8.3: LLM-Driven Evolution Generator

  - **Evolution Generator** (`skills/evolution-generator/index.ts`): Autonomous discovery of improvement opportunities.
    - **Code Review Agent** (`scanCodeSmells`): heuristic scanner detecting magic numbers, long functions (>50 lines), missing TypeScript return types, deep nesting, unused imports.
    - **Test Gap Analyzer** (`analyzeTestGaps`): maps source files to test files; flags completely untested files and partially covered exports.
    - **Auto-Proposal** (`runAutoReview`): prioritizes high-severity smells → test gaps → any smell, and packages findings into a fully-formed `EvolutionProposal` ready for the approval pipeline.
    - Architecture预留了 LLM 替换接口：启发式扫描器可随时替换为基于 LLM 的 AST 分析，无需改动提案生成逻辑。

## 0.6.0

### Minor Changes

- v8.0: Self-Modification Engine

  ### Phase 1: Diff Application Engine

  - **Self-Modification Engine** (`skills/self-modify/index.ts`): Evolves from a simple file writer to a production-grade diff application engine.
    - `applyDiffs(diffs, options?)`: batch-applies unified diffs or full content replacements with 4-layer safety.
    - `parseUnifiedDiff(diffText)` + `applyHunks(lines, hunks)`: robust unified diff parser with bottom-to-top hunk application to avoid index shifting.
    - **Constitution Guard integration**: every file mutation passes through `evaluateConstitutionGuard()` before any filesystem touch — blocks `core/` deletions and immutable path modifications.
    - **Atomic write**: temp file → validation → rename, preventing partial writes on crash.
    - **Syntax validation**: runs `tsc --noEmit` after applying TS/JS diffs; rolls back entire batch on any type error.
    - **Backup/restore**: `createBackup()` snapshots all target files before mutation; `restoreBackup()` restores from snapshot on failure.
    - **Dry-run mode**: validates constitution and parses diffs without touching the filesystem.

  ### Phase 2: Evolution Pipeline Integration

  - **Version manager diffs persistence** (`skills/evolution-version-manager/index.ts`): `createVersion()` now accepts and persists `diffs` to `evolution_diffs` table; `getVersion()` restores them automatically.
  - **Orchestrator self-modify integration** (`skills/evolution-orchestrator/index.ts`): `executeEvolution()` now:
    1. Fetches diffs from the version record
    2. Calls `applyDiffs()` with backup + syntax check
    3. Rolls back and marks version `rollback` on diff failure
    4. Runs incremental tests; if tests fail, restores backup and reports failure
  - **Legacy backward compatibility**: old `selfModifyTool`, `ruleEngineOverrideTool`, `applyPatch`, `mutateFile`, `setSelfModifyConfirmCallback` all preserved and enhanced with canary test support.

## 0.5.0

### Minor Changes

- v7.1: Evolution Auto-Execution + Feedback Loop v2

  ### Phase 1: Evolution Execution Daemon

  - **Evolution Executor** (`skills/evolution-executor/index.ts`): Background daemon that auto-executes approved evolution versions.
    - `ExecutionDaemon` polls the DB every 30s (configurable) for versions with `approval_status = 'approved'` and `applied_at IS NULL`.
    - Respects safety controls: skips execution when ChangeFreezePeriod is active or mutex lock is held by another owner.
    - Acquires lock, marks version applied, triggers incremental test runner, records budget spend, then releases lock.
    - Emits `evolution:executed` event on completion and `evolution:failed` on any error.
    - Configurable `maxConcurrent` (default 1) to prevent overload.
    - `listExecutions()` / `getExecution()` APIs for monitoring.

  ### Phase 2: Evolution Feedback Loop v2

  - **Evolution Feedback** (`skills/evolution-feedback/index.ts`): Listens to `evolution:failed` events and automatically triggers recovery.
    - **Rollback**: queries `getRollbackTarget()` from version manager and marks failed version as `rolled_back`.
    - **Self-Healing**: runs `SelfHealer.attemptRepair()` to diagnose the failure and propose a repair strategy.
    - **Memory Query**: pulls similar historical failures from Knowledge Base to inform the fix.
    - **Fix Proposal**: generates an adjusted `EvolutionProposal` (e.g. filters `core/` files on constitution failure, adds test files on test failure).
    - **Auto-Repropose** (opt-in via `autoRepropose: true`): submits the adjusted proposal back through the pipeline.
    - Persists every feedback cycle to `evolution_feedback` table for audit.
    - Emits `evolution:rolledBack` event with rollback details.

  ### Integration

  - Extended `HookEventType` in `core/hook-system.ts` with 4 new lifecycle events:
    - `evolution:proposed`, `evolution:approved`, `evolution:executed`, `evolution:failed`
  - EventBus wiring: `registerExecutionDaemon()` and `registerFeedbackLoop()` called once at startup to bind all listeners.

## 0.4.0

### Minor Changes

- v6.1: Multi-Agent Consensus, Evolution Memory & Web Control Panel

  ### Phase 1: Multi-Agent Consensus v2

  - **Evolution Consensus** (`skills/evolution-consensus/index.ts`): 4 specialized reviewers (security, architecture, testing, cost) vote on every evolution proposal.
    - Security reviewer has **veto power**: any CRITICAL violation immediately rejects the proposal regardless of other votes.
    - Consensus engine aggregates votes via greedy Jaccard clustering + majority voting.
    - Adjusts risk score based on consensus strength: strong approval lowers risk, rejection boosts it to 100+.
  - **Orchestrator integration** (`skills/evolution-orchestrator/index.ts`): Consensus review inserted as Stage 2 in the pipeline, between Constitution Check and Budget Check. New `PipelineOptions.skipConsensus` flag for backward compatibility.

  ### Phase 2: Knowledge Base Evolution Memory

  - **Evolution Memory** (`skills/evolution-memory/index.ts`): Records every evolution outcome (success/failure, stage, lesson learned) into the Knowledge Base as structured Markdown documents.
    - `recordEvolutionMemory()`: persists outcome with RAG-compatible formatting.
    - `queryEvolutionMemory()`: retrieves similar historical proposals before making new decisions.
    - `deriveLesson()`: auto-generates human-readable lessons from pipeline results.
  - **Orchestrator integration**: `proposeEvolutionWithMemory()` queries KB for hints before proposing; `executeEvolutionWithMemory()` records the outcome after execution.

  ### Phase 3: Web UI Evolution Control Panel

  - **API endpoints** (`web/routes/handlers/evolution.ts`):
    - `GET /api/evolution/approvals` — list pending approvals
    - `GET /api/evolution/versions` — list version history
    - `POST /api/evolution/approve` — approve/deny a pending evolution
    - `POST /api/evolution/rollback` — get rollback target for a version
  - **Frontend components**:
    - `EvolutionControlPanel.jsx`: embedded in SystemDashboard, shows pending approvals with approve/reject buttons, version history with rollback button, and error handling.
    - Integrated alongside existing `EvolutionPipelineCard` in a 2-column layout.

  ### Tests

  - 29 new tests across consensus, memory, orchestrator, and API handlers.
  - Total: 968 tests passed, 0 failed.

## 0.3.0

### Minor Changes

- v5.3: Evolution Safety & Monitoring Pipeline

  ### Phase A — Core Infrastructure

  - **Production EventBus** (`core/event-bus.ts`): async event queue with retry, exponential backoff, and persistent SQLite dead-letter storage. Backward-compatible with HookRegistry.
  - **Semantic Constitution Checker** (`skills/semantic-constitution/index.ts`): extends path-based guard with case-insensitive protected path detection, distortion detection (e.g. `B1BLE.md`), impact chain analysis (config → infrastructure), dangerous code pattern detection (eval, exec, shell=true), and change size limits.
  - **Safety Controls** (`skills/safety-controls/index.ts`): EvolutionLock mutex, ChangeFreezePeriod (24h cooldown), and BudgetController with daily/monthly SQLite-backed spending caps.

  ### Phase B — Evolution Quality

  - **Hybrid Approval Generator** (`skills/approval/index.ts`): risk-based 4-tier approval routing (auto / delayed / manual / denied), with SQLite persistence and batch delay expiration.
  - **Evolution Version Manager** (`skills/evolution-version-manager/index.ts`): global semver versioning with parent-child lineage, rollback targets, and lifecycle tracking (applied / test status).
  - **Incremental Test Runner** (`skills/incremental-test/index.ts`): smart file → test mapping for core/skills/web, supporting both incremental and full test runs with pluggable execution.

  ### Phase C — Monitoring & Integration

  - **Monitoring Dashboard** (`skills/monitoring-dashboard/index.ts`): unified real-time snapshot aggregating EventBus, Safety, Approvals, Versions, TestRuns, and EvolutionMetrics.
  - **Evolution Orchestrator** (`skills/evolution-orchestrator/index.ts`): end-to-end integration pipeline — `proposeEvolution` (Constitution → Budget → Approval → Version) and `executeEvolution` (Apply → Freeze → Test → Record).
  - **API endpoints** (`web/routes/handlers/monitoring.ts`): `/api/monitoring/{status,event-bus,safety,approvals,versions,test-runs}`.
  - **Frontend Evolution Pipeline Card** (`web/src/components/EvolutionPipelineCard.jsx`): real-time evolution pipeline status embedded in SystemDashboard.

  ### Tests

  - 55 new tests across all 8 modules, all passing.
  - Total: 950 tests passed, 0 failed.

## 0.2.0

### Minor Changes

- Phase 1: Stability & Quality Foundation

  ### Patch Changes

  - Fixed `await import("crypto")` in non-async function in `web/routes/shared.ts`
  - Fixed missing `CronPatterns`, `createTaskScheduler`, `isValidCron` re-exports in `core/task-scheduler.ts`
  - Fixed broken retry logic in `core/task-workers.ts` (retry timer was immediately cleaned up)
  - Implemented missing `callAuxiliary` function in `core/auxiliary-llm.ts`
  - Fixed `llm-stream-providers.ts` to handle undefined `res.headers`
  - Rewrote `llm-resilience.test.ts` to mock `streamLLM` instead of obsolete `callLLM`
  - Fixed `server-api.test.ts` 401 failures by dynamically reading API token from `appConfig`
  - Fixed `credentialStrip` regex in `tools/mcp-client/index.ts` to preserve key names
  - Removed 15+ `.bak` backup files from `skills/`
  - Resolved 70+ TypeScript errors across `core/`, `tools/`, `deploy/`, `tests/`
  - All tests green: 725 passed, 0 failed
  - Typecheck green: 0 errors
  - Lint green: 0 errors (46 warnings remaining)

- Phase 2: Memory Wiki depth + Persona style learning

  ### Memory Wiki

  - **Claim Graph** (`claim-graph.ts`): typed relations between claims — supports, refutes, refines, related — with strength scores and BFS subgraph queries.
  - **Confidence Engine** (`confidence-engine.ts`): propagates confidence across the claim graph. Supporting claims boost confidence; refuting claims penalize it.
  - **Evidence Tree** (`evidence-tree.ts`): hierarchical evidence tracking with parent-child chains, provenance roots, and level-order traversal.
  - **Claim Search** (`search.ts`): full-text + structured search over claims (category, status, freshness, confidence range, pagination).
  - `addContradiction` now auto-registers a `refutes` relation in the graph.

  ### Personality v2

  - **Style Learner** (`style-learner.ts`): extracts 5 style dimensions (formality, verbosity, humor, technicality, empathy) from high-rated samples using heuristic text analysis.
  - **Style Adaptation** (`adaptStyle`): context-aware prompt generation that switches dimensions based on keywords (technical, urgent, emotional, casual).
  - Profile scores are persisted to `style_dimensions` table with reliability weights.

- Phase 3: Evolution Viz UI polish + backend API

  ### Backend

  - **Metrics Aggregator** (`metrics-aggregator.ts`): total evolutions, cost, avg risk, success/approval/rollback rates, trigger breakdown, high-risk count.
  - **Trend Detector** (`trend-detector.ts`): cost/risk/frequency trend analysis (rising/falling/stable) + anomaly detection (cost spikes, risk spikes, rollback clusters, approval drops).
  - **API endpoints**:
    - `GET /api/evolution/history` — enriched commit history with metadata
    - `GET /api/evolution/metrics` — aggregate statistics
    - `GET /api/evolution/trends` — trend report with anomalies
    - `GET /api/evolution/timeseries?days=` — daily time series
  - `resetMetadataDb()` now cleans up the evolution DB file to prevent cross-test contamination.

  ### Frontend

  - **EvolutionTimeline** enhanced with:
    - Top metric cards (total, cost, success rate, avg risk)
    - Status and trigger dropdown filters
    - Expand / Collapse all toggle
    - Risk level badges (R1–R10) with color coding
    - Inline diff stats (+insertions, -deletions, files changed)
    - Filter counter and clear button

- Phase 4: Knowledge Brain — 5-lane search optimization

  ### Search Optimization

  - **Semantic Lane v2**: FTS5 pre-filtering (up to 200 candidates) + unigram/bigram combined scoring instead of full-table scan.
  - **Graph Lane v2**: Degree-weighted scoring via CTE; enriched metadata with `sourceId`, `targetId`, `depth`.
  - **Weighted RRF Fusion**: Lane-specific weights (keyword 1.2, semantic 1.1, graph 0.9, temporal 0.7) for better result quality.
  - **Smart Lane Orchestration**: Temporal lane skipped when no `timeRange` filter; vector lane placeholder still called but negligible cost.

  ### Query Cache

  - LRU in-memory cache (max 100 entries, 60s TTL) with `getCachedSearch` / `setCachedSearch` / `clearSearchCache`.

  ### Search Analytics

  - Per-lane latency/candidate/hit tracking via `recordSearchStats`.
  - `getLanePerformanceSummary()` returns avg candidates, latency, and hit rate per lane.

  ### Tests

  - 17 new tests covering all 5 lanes, fusion ranker, cache, analytics, and orchestrator behavior.

- Phase 5: Agent Collaboration — Crew Orchestrator enhancements

  ### Crew History

  - **crew-history.ts**: SQLite persistence for crew runs (`crew_runs` table) and per-task results (`crew_run_tasks` table).
  - `recordCrewRun()` / `getCrewRunHistory()` / `getCrewRunTasks()` / `getCrewRunMetrics()`

  ### Consensus Engine

  - **consensus-engine.ts**: Resolves multi-agent disagreements via greedy Jaccard clustering + majority voting.
  - `runConsensus(answers)` → `{ winner, winnerAgentId, clusterSize, agreementRatio, runnerUps }`
  - Tie-breaking by confidence score when clusters are equal size.

  ### Handoff Protocol

  - **handoff.ts**: Standardized context passing between agents.
  - `createHandoff()` / `applyHandoff()` / `serializeHandoff()` / `deserializeHandoff()`
  - Carries summary, key findings, open questions, constraints, and artifacts.

  ### Orchestrator Tests

  - New test suite for `skills/orchestrator/` covering worker stats, idle cleanup, and delegate task tool metadata.

### Patch Changes

- Core Slimming Phase 3 & 4: Migrate utility and infrastructure modules from `core/` to `skills/`

  Continues the "immutable kernel" boundary restoration. All migrated modules are replaceable Skills.

  **Phase 3 — Moved from `core/` to `skills/`:**

  - **`core/backup.ts`** → `skills/backup/index.ts`
    - SQLite backup/restore with WAL checkpointing
  - **`core/sandbox.ts`** → `skills/sandbox/index.ts`
    - Subagent context isolation (forkedAgent pattern)
  - **`core/i18n.ts`** → `skills/i18n/index.ts`
    - 13-locale backend internationalization

  **Phase 4 — Moved from `core/` to `skills/`:**

  - **`core/webhook-manager.ts`** → `skills/webhooks/index.ts`
    - Webhook registration, signature verification, and delivery
  - **`core/notification-bus.ts`** → `skills/notification/index.ts`
    - Lightweight global EventEmitter for cross-layer notifications
  - **`core/session-archiver.ts`** → `skills/session-archiver/index.ts`
    - Session archiving, export, and cleanup
  - **`core/telemetry.ts`** + **`telemetry-spans.ts`** + **`otel.ts`** + **`otel-exporter.ts`** → `skills/telemetry/`
    - OpenTelemetry spans, metrics, and OTLP HTTP exporter
  - **`core/mcp-connection-manager.ts`** + **`mcp-output-storage.ts`** + **`mcp-utils.ts`** → `skills/mcp/`
    - MCP server connection lifecycle, output persistence, JSON-Schema-to-Zod conversion

  **Reliability fixes bundled:**

  - `web/ws-server.ts`: `attachWebSocket` now properly cleans up previous heartbeat timers and `notificationBus` listeners before attaching new ones. `closeWebSocket` clears all module-level state, eliminating EventEmitter leak warnings.
  - `core/db-manager.ts`: `runMigrationsSync` now wraps migration execution in `BEGIN IMMEDIATE ... COMMIT`, preventing `SqliteError: duplicate column name` race conditions when multiple tests initialize the DB concurrently.

  **Code quality:**

  - Resolved all 23 ESLint `@typescript-eslint/no-unused-vars` warnings across 12 files.

  **Kernel boundary after Phases 2–4:** `core/` contains only `rule-engine.ts`, `tool-framework.ts`, `permission-gate.ts`, plus infrastructure (`db-manager`, `db-adapter`, `config`, `logger`). Everything else is a Skill.

- Core Slimming Phase 5: Migrate remaining skill-like modules from `core/` to `skills/`

  Moves the last batch of clearly replaceable functional modules out of the immutable kernel:

  - **`core/budget-guard.ts`** → `skills/budget-guard/index.ts`
  - **`core/rate-limiter.ts`** → `skills/rate-limiter/index.ts`
  - **`core/smart-cache.ts`** → `skills/smart-cache/index.ts`
  - **`core/skills-guard.ts`** → `skills/skills-guard/index.ts`
  - **`core/skill-versioning.ts`** → `skills/skill-versioning/index.ts`
  - **`core/hot-reload.ts`** → `skills/hot-reload/index.ts`

  All consumers updated (`web/routes/`, `extensions/im/`, `skills/`, `scripts/`, tests).

  **Kernel boundary after Phase 5:** `core/` contains only the 3 sacred files (`rule-engine`, `tool-framework`, `permission-gate`) plus hard infrastructure (`db-*`, `config`, `logger`, `redis`, `llm-router`, `session-db`, `errors`, `safe-utils`). Everything else is a Skill.

- Core Slimming Phase 2: Migrate non-kernel modules from `core/` to `skills/`

  Restores the "immutable kernel" boundary by moving replaceable modules out of `core/` into dedicated skill directories:

  - **`core/checkpoint-manager.ts`** → `skills/checkpoint/index.ts`

    - Shadow-git checkpoint system for filesystem snapshots
    - Consumers updated: `main.ts`, `skills/agent-loop/runner.ts`, `skills/self-modify/index.ts`, `skills/self-healing/self-healer.ts`

  - **`core/task-scheduler*.ts`** + **`core/task-queue.ts`** + **`core/task-workers.ts`** + **`core/task-prioritizer.ts`** → `skills/task-scheduler/`

    - Cron/interval/delayed task orchestration with retry, timeout, and circuit-like backoff
    - Consumers updated: `web/routes/shared.ts`, `web/routes/lib/metrics.ts`

  - **`core/self-healing.ts`** + **`core/self-healer.ts`** + **`core/anomaly-classifier.ts`** + **`core/snapshot-manager.ts`** + **`core/rollback-manager.ts`** + **`core/repair-strategies.ts`** + **`core/canary-runner.ts`** + **`core/self-healing-types.ts`** → `skills/self-healing/`
    - Anomaly detection, snapshot management, rollback, and repair strategies
    - Consumers updated: `web/routes/shared.ts`, `skills/agent-loop/runner.ts`, `skills/self-modify/index.ts`

  Tests relocated to mirror new structure under `tests/skills/{checkpoint,task-scheduler,self-healing}/`.

  **Kernel boundary after migration:** Only `core/rule-engine.ts`, `core/tool-framework.ts`, and `core/permission-gate.ts` remain sacred. Everything else is a replaceable Skill.
