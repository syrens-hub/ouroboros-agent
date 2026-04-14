---
name: memory-never-forget
description: "Memory system v3.1: Atkinson-Shiffrin temporal layering + 4-type taxonomy (User/Feedback/Project/Reference) + auto-extract + Dream consolidation + memory drift handling. Merges cognitive psychology with Claude Code's memory architecture."
metadata: { "openclaw": { "emoji": "🧠" } }
---

# 🧠 Memory Never Forget v3.1

Two orthogonal dimensions working together:

| Dimension | Framework | Purpose |
|-----------|-----------|---------|
| **Temporal** (how long) | Atkinson-Shiffrin 3-stage model | Decay management — what to keep vs. prune |
| **Content** (what kind) | 4-type taxonomy (Claude Code) | Classification — where to store for retrieval |

## How It Works: The Memory Flow

```
New Information
    │
    ▼
┌─────────────────────────┐
│  Sensory Memory          │  ~0.25 sec — instant filter
│  (Current Context)       │  What deserves attention?
└────────┬────────────────┘
         │ worth remembering
         ▼
┌─────────────────────────┐
│  Short-Term Memory       │  ~10 turns — context window
│  (Conversation)          │  Pass through working filter
└────────┬────────────────┘
         │ survives
         ▼
┌─────────────────────────┐
│  Working Memory           │  ~7 days — daily logs
│  (memory/YYYY-MM-DD.md)  │  Raw signal, unclassified
└────────┬────────────────┘
         │
    ┌────▼────┐  every day at 12:30
    │ DREAM   │  The Gateway:
    │         │  1. Scan recent daily logs
    │  ⚙️    │  2. Identify long-term signal
    │  ⚙️    │  3. ★ Classify into 4 types  ← Temporal → Content
    │  ⚙️    │  4. Write to classified file
    │  ⚙️    │  5. Update MEMORY.md index
    │         │  6. Let old logs decay naturally
    └────┬────┘
         │ promoted
         ▼
┌─────────────────────────┐
│  Long-Term Memory        │  Permanent — classified
│  (4 types + index)       │  User / Feedback / Project / Reference
└─────────────────────────┘
```

**In one sentence:** Memory is first filtered by time (when to save, when to let decay), then transformed by Dream into classified content (where to store, how to retrieve).

---

## Dimension 1: Temporal Layering (Atkinson-Shiffrin)

| Stage | Human Equivalent | Implementation | TTL | Action |
|-------|-----------------|----------------|-----|--------|
| **Sensory** | ~0.25 sec perception | Current input context | Instant | Filter immediately — what deserves attention? |
| **Short-term** | Recent 10 turns | Model context window | 10 turns | Pass through working filters |
| **Working** | Recent ~7 days | `memory/YYYY-MM-DD.md` daily logs | 7 days | Extract signal → promote to long-term or let decay |
| **Long-term** | Permanent | `MEMORY.md` (index) + classified files | Permanent | Periodic review, prune when stale |

**The memory flow:**
```
Input → Sensory (filter) → Short-term (hold) → Working (consolidate) → Long-term (index)
                                                                      ↕
                                                              Daily Dream review
                                                              (promote or prune)
```

---

## Dimension 2: Content Classification (4 Types)

| Type | Directory | Content | Example |
|------|-----------|---------|---------|
| **user** | `memory/user/` | User profile (role, preferences, knowledge, goals) | "User is a data analyst, prefers concise replies" |
| **feedback** | `memory/feedback/` | Lessons (corrections, confirmations, style) | "Don't use Markdown tables, use lists" |
| **project** | `memory/project/` | Project state (work, decisions, reasoning) | "Project X adopted Y because it reduces cost" |
| **reference** | `memory/reference/` | External resources (links, tools, locations) | "Project docs are in /docs/api/" |

**How the two dimensions interact:**
- Working layer (`memory/*.md` daily logs) captures raw signal without classification
- Long-term layer stores classified memories (4 types), each with indexed content
- Dream consolidation moves Working → Long-term (classify + promote) OR prunes (decay)

---

## What to Save / What NOT to Save

### ✅ Save
- User's role, preferences, responsibilities, knowledge
- User corrections ("not like that", "should be this way")
- User confirmations ("yes exactly", "perfect, keep that")
- Project decisions and **the reasoning** (not just what, but why)
- New tools, links, resources
- External system locations and their purpose

### ❌ Don't Save
- ❌ Code patterns, architecture, file paths (derivable from codebase)
- ❌ Git history (`git log` is the authoritative source)
- ❌ Debugging solutions (the fix is in the code; commit messages have context)
- ❌ Anything already documented elsewhere
- ❌ Ephemeral task state (write to `todos.md` instead)
- ❌ Raw conversation content

> ⚠️ **Even if the user explicitly asks** — if asked to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that's the part worth keeping.

---

## MEMORY.md = Long-Term Index Only

MEMORY.md is the **index of long-term memories only**, never content. Format:
```
- [Title](path) — one-line description (<150 chars)
```

Example:
```markdown
## User Memory
- [user-profile](user/profile.md) — user role and preferences

## Feedback Memory
- [no-tables](feedback/no-tables.md) — prefer lists over markdown tables

## Project Memory
- [model-switch](project/model-decision.md) — why project switched model

## Reference
- [project-docs](reference/docs-path.md) — where project docs live
```

---

## Memory File Format

Every classified memory file must have frontmatter:

```yaml
---
name: Memory name
description: One-line description (used to judge relevance)
type: user|feedback|project|reference
created: YYYY-MM-DD
---

## Rule / Fact
(the content)

## Why
(reason / motivation)

## How to apply
(when and how to use this memory)
```

---

## Memory Drift Caveat

Memories can become stale. Rules:

1. **Verify first**: When referencing a file, function, or path — check it still exists
2. **Trust current state**: If memory conflicts with current observation, trust what you see now
3. **Update or delete**: When a memory is outdated, fix or remove it immediately
4. **Absolute dates**: Convert relative dates ("yesterday", "last week") to absolute dates

> "The memory says X exists" ≠ "X exists now"

---

## Directory Structure

```
memory/
├── memory-types.md       ← this file
├── user/                 ← long-term user memories
├── feedback/             ← long-term feedback
├── project/              ← long-term project memories
├── reference/            ← long-term references
└── 2026-XX-XX.md        ← working memory (daily logs, 7-day TTL)
```

---

## Retrieval Flow (by question type)

### Memory Questions ("what happened before", "what did we talk about")
→ `memory_search` across MEMORY.md + memory/*.md

→ If not found in memory layer → proactively search daily logs (working memory)

### Knowledge Questions ("look this up", "check that file")
1. Find index in MEMORY.md first
2. Read detailed content from classified file or knowledge layer

### Temporal Questions ("what did I do last Tuesday")
→ Go directly to daily logs (working memory): `memory/YYYY-MM-DD.md`

---

## Feedback Rules

- **Record failures AND successes**: only saving corrections makes you overly cautious
- Corrections are easy to notice; confirmations are quieter — watch for them
- Always include **why** to judge edge cases later

## Project Rules

- Project memories decay fast, so **why** helps future-you judge if the memory is still load-bearing
- Always convert relative dates to absolute dates

---

## Dream Consolidation (Periodic, Automated)

Triggered daily via cron. Acts as the **Working → Long-term promotion gateway**.

### Phases
1. **Orient** — browse existing memory files and index
2. **Gather** — scan working memory (daily logs) for new signal
3. **Consolidate** — promote to classified long-term (4 types), merge, deduplicate
4. **Prune** — remove outdated entries, update index, let daily logs decay naturally

### Rules
- Merge new signal into existing files, not near-duplicates
- Relative dates → absolute dates
- Delete contradicted facts
- Keep MEMORY.md under 5KB
- Remove stale pointers
- Shorten overly long index entries (<150 chars each)

---

## Session Lifecycle (Atkinson-Shiffrin in Practice)

### Session Start
```
1. Sensory: Read current input
2. Short-term: Last 10 turns from context window
3. Working: Read memory/today.md + memory/yesterday.md
4. Long-term: Read MEMORY.md index
```

### During Conversation
```
- New info → write to working memory (today's daily log)
- Learned something worth remembering → update MEMORY.md index + save classified file
- User preference → update USER.md + memory/user/
- Need to retrieve → find in MEMORY.md index → read classified file
```

### Session End
```
- Summarize → write to memory/today.md (working memory)
- Identify items for long-term → update classified files
- Update MEMORY.md index
- Mark items for Dream review (decay candidates)
```

---

## Workspace Structure

```
workspace/
├── MEMORY.md              # long-term memory index
├── USER.md                # user info
├── SOUL.md                # AI identity
├── todos.md               # task tracking
├── HEARTBEAT.md           # daily reminders
├── memory/
│   ├── memory-types.md    # this file
│   ├── user/              # long-term user memories
│   ├── feedback/          # long-term feedback
│   ├── project/           # long-term project memories
│   ├── reference/         # long-term references
│   └── 2026-XX-XX.md     # working memory (daily logs)
└── knowledge/             # knowledge layer (detailed content)
```

---

## Example Interactions

**User provides important info:**
> User: "I'm a data analyst, mostly working with Python"
→ Working: log in today's daily log
→ Long-term: save to `memory/user/user-profile.md`, update MEMORY.md index

**User corrects you:**
> User: "Don't use Markdown tables, use lists"
→ Working: log in today's daily log
→ Long-term: save to `memory/feedback/no-tables.md`, update MEMORY.md index

**Project decision:**
> Decision: approach A over B because lower cost
→ Working: log decision context
→ Long-term: save to `memory/project/decision.md` with reasoning

**Looking up a past date:**
> User: "What did we do last Tuesday?"
→ Working memory: read `memory/YYYY-MM-DD.md` for that date

---

## References

- **Atkinson-Shiffrin model** (1968): Sensory → Short-term → Long-term memory stages
- Claude Code `memoryTypes.ts` — 4-type taxonomy
- Claude Code `extractMemories.ts` — auto-extraction system
- Claude Code `autoDream.ts` — background consolidation system

---

*Version: v3.1 | Updated: 2026-04-03 | Merges Atkinson-Shiffrin temporal layering with Claude Code 4-type taxonomy*
