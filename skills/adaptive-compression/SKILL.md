---
name: adaptive-compression
description: Adaptive context compression with complexity-driven, quality-aware thresholds.
version: 1.0.0
tags: [compression, context, tool]
---

# Adaptive Compression Skill

**Source:** `openclaw-workspace`  
**Version:** 1.0.0  
**Path:** `skills/adaptive-compression/`

---

## Overview

Implements Claude Code's adaptive compression algorithm within OpenClaw. Provides complexity-driven, quality-aware context compression with deterministic thresholds.

## Tools

### assess_compression

Analyze conversation complexity and determine if compression is needed.

```typescript
const result = assessCompression({
  messages: [
    { role: "user", content: "Implement auth system" },
    { role: "assistant", content: "Starting implementation..." },
  ],
  token_budget: 100000,
});

// Returns:
{
  ok: true,
  should_compact: true,
  complexity: {
    total: 45000,
    code_block_count: 3,
    unique_file_count: 2,
    error_density: 0.1,
  },
  threshold: {
    warning_threshold: 180000,
    target_tokens: 35000,
    compression_ratio: 0.349,
    strategy: "conservative",
  },
}
```

### compact_conversation

Compact with quality-guaranteed summary. Generates summary, evaluates quality, retries on failure.

```typescript
const result = await compactConversation({
  session_id: "session-123",
  messages: conversationMessages,
  token_budget: 40000,
  force: false,
});

// Returns:
{
  ok: true,
  compacted: true,
  reason: "compressed in 1 attempt(s), grade: B",
  summary: "## Summary\n\n### Primary Request\n...",
  tokens_before: 180000,
  tokens_after: 35000,
  quality_grade: "B",
  quality_score: 72,
  attempts: 1,
}
```

### log_compression

Log compression assessment as single line for debugging.

```typescript
const { log_line } = logCompression({ messages });
// [AdaptiveCompressor] complexity=45000, [CONSERVATIVE] ratio=0.349, target=35000
```

---

## Core Algorithm

### 1. Complexity Scoring (ComplexityScorer)

Multi-dimensional complexity based on:

| Dimension | Weight | Description |
|-----------|--------|-------------|
| toolResultTokens | 0.4 | Tokens in user messages |
| codeBlockCount | 80 | Number of code blocks |
| uniqueFileCount | 40 | Unique files mentioned |
| errorDensity | 0.3 | Errors per turn |

### 2. Adaptive Threshold (AdaptiveThreshold)

| Strategy | Complexity | Compression Ratio |
|----------|-----------|-------------------|
| aggressive | > 500k | 15-18% |
| normal | 200k-500k | 20-24% |
| conservative | < 200k | 25-35% |

Code-intensive (>50 blocks or >20 files) gets **1.5x multiplier**, capped at 35%.

### 3. Quality Evaluation (QualityEvaluator)

7 dimensions + section completeness (30% weight):

| Dimension | Max Points | Required |
|-----------|-----------|----------|
| File references | 15 | Yes |
| Code snippets | 20 | Yes |
| Error context | 15 | Yes |
| Decision record | 10 | No |
| Pending tasks | 10 | No |
| Coverage ratio | 15 | Yes |
| Information density | 15 | Yes |

**Grade thresholds:** A≥80 (pass), B≥65 (pass), C≥50 (min 60), D<50 (fail)

---

## Architecture

```
adaptive-compression/
├── SKILL.md
├── index.ts                     # Skill entry + tool exports
├── src/
│   ├── types.ts                # Shared types & config
│   ├── ComplexityScorer.ts     # Multi-dimensional complexity
│   ├── AdaptiveThreshold.ts    # Deterministic threshold
│   ├── QualityEvaluator.ts     # 7-dimension quality grading
│   ├── skill-tools.ts          # OpenClaw tool schemas
│   └── AdaptiveCompressorEngine.ts  # Main engine
└── dist/                       # Compiled CommonJS output
```

---

## Compilation

```bash
cd ~/.openclaw/workspace/skills/adaptive-compression
npx esbuild src/*.ts index.ts \
  --bundle --outdir=dist \
  --platform=node --format=cjs \
  --external:@mariozechner/* \
  --external:pi-agent-core
```

---

## Integration Status

| Component | Status |
|-----------|--------|
| Engine (TypeScript) | ✅ Complete |
| CommonJS Compilation | ✅ Working |
| ComplexityScorer | ✅ Tested |
| AdaptiveThreshold | ✅ Tested |
| QualityEvaluator | ✅ Tested |
| OpenClaw Tool Schema | ✅ Complete |
| ContextEngine Registration | ⏳ Pending (requires gateway plugin support) |

---

## Usage in Agent Conversations

```typescript
// Import from workspace skill
import { assessCompression, compactConversation } from "openclaw-workspace:adaptive-compression";

// Before a long task
const assessment = assessCompression({ messages });
if (assessment.should_compact) {
  const result = await compactConversation({
    session_id: sessionId,
    messages,
    token_budget: 40000,
  });
}
```

---

## References

- OpenClaw ContextEngine: `context-engine/types.ts`
- Claude Code AdaptiveCompressor: `AdaptiveCompressor.ts`
- Integration guide: `AdaptiveCompressorIntegration.ts`
