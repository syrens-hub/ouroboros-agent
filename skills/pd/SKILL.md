---
name: PD
slug: pd
version: 2.5.0
homepage: https://clawic.com/skills/pd
description: Personal Development System — the unified self-improvement and productivity operating system. Integrates productivity frameworks, energy management (Feel-Good Productivity), habit building (Atomic Habits), and systems thinking (Cybernetics) into a cohesive personal development system.
changelog: |-
  v2.6.0: Review Routing Rules 补全承诺阶梯审查节奏；周/月模板嵌入 commitment 文件维护清单；references/ 文件夹取消，文件扁平化到 pd/ 根目录；SKILL.md 文件夹结构图修复（commitments 重复问题）；月维护清单补入 habits/friction.md
  v2.5.0: 新增 experimentation-guide.md——实验作为 PD 系统底层引擎，与复盘-迭代中枢联动
  v2.4.0: 承诺阶梯包入 commitments/ 父文件夹
  v2.3.0: 承诺阶梯重组 —— goals/projects/tasks/someday → commitments/0_dream/ ~ commitments/5_archived/ 六级承诺深度体系
  v2.2.0: 日/周/月复盘统一收进 reviews/；删除5个过时 context 文件（parent/creative/burnout/entrepreneur/adhd.md）
  v2.1.0: 清理重复/废弃路径，统一文件夹结构（删除 planning/、reviews/、goals/someday.md）
  v2.0.0: Unified Feel-Good Productivity and Productivity skills into PD as the final self-improvement system
metadata:
  clawdbot:
    emoji: 🎯
    requires:
      bins: []
    os:
      - linux
      - darwin
      - win32
    configPaths:
      - ~/productivity/
---

## When to Use

Use this skill when the user wants a unified self-improvement system, not just one-off motivation. PD covers:

- **Productivity**: goals, projects, tasks, reviews
- **Energy Management**: Feel-Good principles (Play/Power/People, Energise/Unblock/Sustain)
- **Habit Building**: Atomic Habits framework (Cue-Craving-Response-Reward)
- **Systems Thinking**: Cybernetics applied to personal development

This is the final, unified self-improvement skill — all productivity and personal development work routes through PD.

## Architecture

Productivity lives in `~/productivity/`. If `~/productivity/` does not exist yet, run `setup.md`.

```
~/productivity/
├── memory.md                 # Work style, constraints, energy, preferences
├── dashboard.md              # High-level direction and current focus
├── inbox/
│   ├── capture.md            # Quick capture before sorting
│   └── triage.md             # Triage rules and current intake
├── commitments/
│   ├── 0_dream/                   # ★ 承诺阶梯：按承诺深度组织意图
│   │   └── ideas.md              # 梦想/探索方向（不承诺）
│   ├── 1_intent/
│   │   └── active.md             # 90-Day Outcome Goals（有意图，待规划）
│   ├── 2_queued/
│   │   └── active.md             # In-flight projects（已规划项目）
│   ├── 3_committed/
│   │   ├── next-actions.md       # Concrete next steps（本周可执行行动）
│   │   ├── this-week.md          # This week's commitments（本周承诺）
│   │   └── waiting.md            # Waiting-for items（等待外部）
│   ├── 4_done/
│   │   └── achievements.md       # Completed items worth keeping（已完成经验）
│   ├── 5_archived/
│   │   ├── waiting-projects.md   # Blocked/delegated projects（暂停/归档项目）
│   │   └── waiting-tasks.md      # Blocked tasks（归档等待项）
│   ├── promises.md                # Commitments made to self or others
│   └── delegated.md               # Handed-off work to track
├── focus/
│   ├── sessions.md           # Deep work sessions and patterns
│   └── distractions.md       # Repeating focus breakers
├── routines/
│   ├── morning.md            # Startup routine and first-hour defaults
│   └── shutdown.md           # End-of-day reset and carry-over logic
```

> **已废弃（不要使用）**：`planning/`、`goals/someday.md`、`goals/`、`projects/`、`tasks/`、`someday/`（v2.3.0 前旧版承诺体系）。如发现任何引用，报告给 skill 维护者。
> **当前承诺体系**：`commitments/0_dream/`（梦想）、`commitments/1_intent/`（意图）、`commitments/2_queued/`（项目）、`commitments/3_committed/`（行动）、`commitments/4_done/`（完成）、`commitments/5_archived/`（归档）。

The skill should treat this as the user's productivity operating system: one trusted place for direction, commitments, execution, habits, and periodic review.

## Quick Reference

| Topic                        | File                       |
| ---------------------------- | -------------------------- |
| Setup and routing            | `setup.md`                 |
| Memory structure             | `memory-template.md`       |
| Productivity system template | `system-template.md`       |
| Cross-situation frameworks   | `frameworks.md`            |
| **Feel-Good Integration**    | `feel-good-integration.md` |
| Habit context                | `habits.md`                |
| Renew                        | experimentation-guide.md   |
| Tired                        | burnout-prevention.md      |
| Procrastination              | unblock-guide.md           |



## Review Routing Rules

**日复盘 → `~/productivity/reviews/daily/YYYY-MM-DD.md`**
每日结束后在对应文件中记录，包含时间块实况、Feel-Good Score、Evening Review（Done well / Not done / Insight）、Today's Focus（写在第二天早上）。文件名格式：YYYY-MM-DD.md（如 2026-04-02.md）。

**周复盘 → `~/productivity/reviews/weekly/YYYY-Wnn.md`**
每周结束后写入，如 W10（3/9-15）、W11（3/16-22）。是跨天的宏观总结，不存放单日记录。包含 Feel-Good Score、核心成果、Burner Check、做得不好+改进、下周 ONE thing。模板见 `weekly/template.md`。

**月复盘 → `~/productivity/reviews/monthly/YYYY-MM.md`**
每月结束后写入，如 2026-03.md。格式：月度 Feel-Good 走势表、本月最骄傲的事（叙事段落）、做得不好/下次改进、Burner 走势表、月度核心洞察、下月 3 个承诺。模板见 `monthly/template.md`。

**跨层归位原则**：单日内容只进 daily，不进 weekly；单周汇总只进 weekly，不进 monthly。复盘颗粒度匹配容器层级。

**承诺阶梯审查节奏（每次复盘必须执行）**：
- **每日复盘时**：清理 `commitments/3_committed/next-actions.md`（划掉已完成）、`commitments/3_committed/this-week.md`（更新本周进度）；如有完成项，移入 `commitments/4_done/achievements.md`
- **每周复盘时**：检查 `commitments/2_queued/active.md`（各项目进度）；更新 `commitments/3_committed/waiting.md`（外部阻塞状态）；更新 `commitments/3_committed/this-week.md`
- **每月复盘时**：review `commitments/1_intent/active.md`（90-Day Goal 进度）；对 `commitments/0_dream/ideas.md` 做 Someday Audit（哪些梦想时机成熟可以升为 intent）；检查 `commitments/5_archived/` 是否有可以重启的项
- **每季归档时**：清理 `commitments/4_done/achievements.md`；对 `commitments/5_archived/` 做全面 audit

> 详细升降规则和审查节奏见 `commitments/承诺阶梯_README.md`。

**系统文件维护节奏（每次复盘必须执行）**：
- **每周复盘时**：
  - 更新 `dashboard.md`——本周 ONE thing、当周承诺列表、Burner 状态
  - 更新 `focus/sessions.md`——记录本周深度工作块（高效/低效时段、环境因素）
  - 更新 `focus/distractions.md`——本周打断源模式，验证上次的解决方案是否有效
  - 检查 `commitments/promises.md`——对外承诺是否有跟进、是否逾期
- **每月复盘时**：
  - 更新 `dashboard.md`——月度主题、Active Goals 进度、所有 Next Milestone 状态
  - review `habits/active.md`——各习惯 Status（🟢🟡🔴），做 Drop / Design / Keep 决策；同步 review `habits/friction.md`，确认阻碍源是否仍然存在或已有解决方案
  - review `routines/morning.md`——晨间流程是否仍适合现实，必要时简化
  - review `routines/shutdown.md`——晚间流程是否保护了睡眠质量
  - review `inbox/triage.md`——triage 规则和项目归位路径是否需要更新

**绝对禁止**：
- 把 daily 日志写进 `daily/` 以外的位置（正确位置是 `reviews/daily/`）
- 把 weekly 总结写进 `weekly/` 以外的位置
- 日志文件用 "daily_2026-03-22.md" 这种带前缀的命名，统一用 `YYYY-MM-DD.md` 格式
- 把 someday 性质的内容放进 `commitments/0_dream/`，而不是 `goals/`

## User-Specific Rules（及时更新）



## Feel-Good Productivity Integration

This skill includes **Feel-Good Productivity** as the energy management layer:

- **Energise**: Play/Power/People activation (`feel-good-framework.md`)
- **Unblock**: Uncertainty/Fear/Inertia solutions (`unblock-guide.md`)
- **Sustain**: Four Burners and burnout prevention (`burnout-prevention.md`)
- **Experiment Your Way**: The meta-skill connecting all PD components via systematic experimentation (`experimentation-guide.md`)

See `feel-good-integration.md` for how to apply Feel-Good principles across all PD modules.

## What This Skill Sets Up

| Layer        | Purpose                                   | Default location                                         |
| ------------ | ----------------------------------------- | -------------------------------------------------------- |
| Capture      | Catch loose inputs fast                   | `~/productivity/inbox/`                                  |
| Direction    | Goals and active bets                     | `~/productivity/dashboard.md` + `commitments/1_intent/` |
| Execution    | Next actions and commitments              | `~/productivity/commitments/3_committed/`                 |
| Projects     | Active and waiting project state          | `~/productivity/commitments/2_queued/`                   |
| Habits       | Repeated behaviors and friction           | `~/productivity/habits/`                                 |
| Reflection   | Daily, weekly, and monthly reset          | `~/productivity/reviews/daily/` + `weekly/` + `monthly/` |
| Commitments  | Promises and delegated follow-through     | `~/productivity/commitments/`                            |
| Focus        | Deep work protection and distraction logs | `~/productivity/focus/`                                  |
| Routines     | Startup and shutdown defaults             | `~/productivity/routines/`                               |
| Parking lot  | Non-committed ideas                       | `~/productivity/commitments/0_dream/`                   |
| Personal fit | Constraints, energy, preferences          | `~/productivity/memory.md`                               |

This skill should give the user a single framework that can absorb:
- goals
- projects
- tasks
- habits
- priorities
- focus sessions
- routines
- reviews
- commitments
- inbox capture
- parked ideas
- bottlenecks
- context-specific adjustments

## Quick Queries

| User says                       | Action                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| "Set up my productivity system" | Create the `~/productivity/` baseline and explain the folders                          |
| "What should I focus on?"       | Check dashboard + tasks + commitments + focus, then surface top priorities             |
| "Help me plan my week"          | Use goals, projects, commitments, routines, and energy patterns to build a weekly plan |
| "I'm overwhelmed"               | Triage commitments, cut scope, and reset next actions                                  |
| "Turn this goal into a plan"    | Convert goal -> project -> milestones -> next actions                                  |
| "Do a weekly review"            | Update wins, blockers, carry-overs, and next-week focus                                |
| "Help me with habits"           | Use `habits/` to track what to keep, drop, or redesign                                 |
| "Help me reset my routine"      | Use `routines/` to simplify startup and shutdown loops                                 |
| "Remember this preference"      | Save it to `~/productivity/memory.md` after explicit confirmation                      |

## Core Rules

### 1. Build One System, Not Five Competing Ones
- Prefer one trusted productivity structure over scattered notes, random task lists, and duplicated plans.
- Route goals, projects, tasks, habits, routines, focus, and reviews into the right folder instead of inventing a fresh system each time.
- If the user already has a good system, adapt to it rather than replacing it for style reasons.

### 2. Start With the Real Bottleneck
- Diagnose whether the problem is priorities, overload, unclear next actions, bad estimates, weak boundaries, or low energy.
- Give the smallest useful intervention first.
- Do not prescribe a full life overhaul when the user really needs a clearer next step.

### 3. Separate Goals, Projects, and Tasks Deliberately
- 承诺阶梯组织意图：0_dream（探索）→ 1_intent（目标）→ 2_queued（项目）→ 3_committed（行动）→ 4_done（完成）→ 5_archived（归档）
- Goals describe outcomes (in `commitments/1_intent/active.md`).
- Projects package the work needed to reach an outcome (in `commitments/2_queued/active.md`).
- Tasks are the next visible actions (in `commitments/3_committed/next-actions.md`).
- Habits are repeated behaviors that support the system over time (in `habits/`).
- Someday/Maybe items are non-committed ideas (in `commitments/0_dream/ideas.md`).
- Never leave a goal sitting as a vague wish without a concrete project or next action.

### 4. Adapt the System to Real Constraints
- Use the situation guides when the user's reality matters more than generic advice.
- Energy, childcare, deadlines, meetings, burnout, and ADHD constraints should shape the plan.
- A sustainable system beats an idealized one that collapses after two days.

### 5. Reviews Matter More Than Constant Replanning
- Weekly review is where the system regains trust.
- Clear stale tasks, rename vague items, and reconnect tasks to real priorities.
- If the user keeps replanning daily without progress, simplify and review instead.

### 6. Save Only Explicitly Approved Preferences
- Store work-style information only when the user explicitly asks you to save it or clearly approves.
- Before writing to `~/productivity/memory.md`, ask for confirmation.
- Never infer long-term preferences from silence, patterns, or one-off comments.

## Common Traps

- Giving motivational talk when the problem is actually structural.
- Treating every task like equal priority.
- Mixing goals, projects, and tasks in the same vague list.
- Building a perfect system the user will never maintain.
- Recommending routines that ignore the user's real context.
- Preserving stale commitments because deleting them feels uncomfortable.
- Creating duplicate folders or files with overlapping content (use this architecture as source of truth).

## Scope

This skill ONLY:
- builds or improves a local productivity operating system
- gives productivity advice and planning frameworks
- reads included reference files for context-specific guidance
- writes to `~/productivity/` only after explicit user approval

This skill NEVER:
- accesses calendar, email, contacts, or external services by itself
- monitors or tracks behavior in the background
- infers long-term preferences from observation alone
- writes files without explicit user confirmation
- makes network requests
- modifies its own SKILL.md or auxiliary files

## External Endpoints

This skill makes NO external network requests.

| Endpoint | Data Sent | Purpose |
|----------|-----------|---------|
| None | None | N/A |

No data is sent externally.

## Data Storage

Local files live in `~/productivity/`.

- `~/productivity/memory.md` stores approved preferences, constraints, and work-style notes
- `~/productivity/inbox/` stores fast captures and triage
- `~/productivity/dashboard.md` stores top-level direction and current focus
- `~/productivity/commitments/1_intent/active.md` stores active outcome goals (90-day)
- `~/productivity/commitments/2_queued/active.md` stores in-flight projects
- `~/productivity/commitments/5_archived/waiting-projects.md` stores blocked or delegated projects
- `~/productivity/commitments/3_committed/next-actions.md` stores concrete next steps
- `~/productivity/commitments/3_committed/this-week.md` stores this week's commitments
- `~/productivity/commitments/3_committed/waiting.md` stores waiting-for items
- `~/productivity/commitments/4_done/achievements.md` stores completed items worth keeping
- `~/productivity/commitments/0_dream/ideas.md` stores parked ideas and optional opportunities
- `~/productivity/habits/active.md` stores current habits and streak intent
- `~/productivity/habits/friction.md` stores friction points
- `~/productivity/reviews/daily/` stores daily review logs (YYYY-MM-DD.md format)
- `~/productivity/reviews/weekly/` stores weekly review logs (YYYY-Wnn.md format) + template.md
- `~/productivity/reviews/monthly/` stores monthly review logs (YYYY-MM.md format) + template.md
- `~/productivity/commitments/promises.md` stores commitments made
- `~/productivity/commitments/delegated.md` stores delegated items to track
- `~/productivity/focus/sessions.md` stores deep-work sessions
- `~/productivity/focus/distractions.md` stores distraction patterns
- `~/productivity/routines/morning.md` stores startup defaults
- `~/productivity/routines/shutdown.md` stores end-of-day reset
- `~/productivity/commitments/0_dream/ideas.md` stores parked ideas and optional opportunities

Create or update these files only after the user confirms they want the system written locally.

## Migration

If upgrading from an older version, see `migration.md` before restructuring any existing `~/productivity/` files.
Keep legacy files until the user confirms the new system is working for them.

**v2.3.0 重大变更**：
- 承诺阶梯重组：`goals/`+`projects/`+`tasks/`+`someday/` → `commitments/0_dream/`、`commitments/1_intent/`、`commitments/2_queued/`、`commitments/3_committed/`、`commitments/4_done/`、`commitments/5_archived/`
- 迁移映射：someday → 0_dream；goals → 1_intent；projects/active → 2_queued；tasks/next-actions+this-week → 3_committed；tasks/done → 4_done；projects/waiting+tasks/waiting → 5_archived

**v2.2.0 重大变更**：
- 日/周/月复盘统一收进 `reviews/` 目录：`reviews/daily/`、`reviews/weekly/`、`reviews/monthly/`
- 删除了5个过时的 context 文件：`parent.md`、`creative.md`、`burnout.md`、`entrepreneur.md`、`adhd.md`

**v2.1.0 重大变更**：
- 删除了 `planning/`、`reviews/`、`goals/someday.md`
- 日/周/月复盘统一进入 `daily/`、`weekly/`、`monthly/`（模板见各目录下的 template.md）
- Someday/Maybe 内容统一进入 `someday/ideas.md`

## Security & Privacy

**Data that leaves your machine:**
- Nothing. This skill performs no network calls.

**Data stored locally:**
- Only the productivity files the user explicitly approves in `~/productivity/`
- Work preferences, constraints, priorities, and planning artifacts the user chose to save

**This skill does NOT:**
- access internet or third-party services
- read calendar, email, contacts, or system data automatically
- run scripts or commands by itself
- monitor behavior in the background
- infer hidden preferences from passive observation

## Trust

This skill is instruction-only. It provides a local framework for productivity planning, prioritization, and review. Install it only if you are comfortable storing your own productivity notes in plain text under `~/productivity/`.


## Feedback
- If useful: `github star pd`
