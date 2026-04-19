# Evolution Core

## Purpose

This directory serves as the **domain boundary marker** for the evolution skill cluster.

The evolution subsystem consists of tightly-coupled skills that together enable the self-modification loop:

- `evolution-feedback` — evaluates mutation outcomes
- `evolution-orchestrator` — coordinates the pipeline
- `evolution-consensus` — multi-agent review & voting
- `evolution-memory` — records lessons from past evolutions
- `evolution-version-manager` — tracks code versions
- `semantic-constitution` — constitutional checks
- `safety-controls` — budget & freeze gates
- `incremental-test` — targeted test runner
- `self-modify` — applies diffs atomically
- `self-healing` — rollback & repair

## Architecture Decision

These skills are intentionally allowed to depend on each other **within the evolution domain**.
Unlike the rest of the skill ecosystem, they form a single cohesive subsystem with a shared lifecycle.

**Cross-domain imports (evolution → non-evolution) are prohibited.**
Evolution skills must communicate with the rest of the system via:
- `core/event-bus.ts` for notifications
- `core/hook-system.ts` for extensibility hooks
- `types/evolution.ts` for shared type definitions

## Future Decoupling Plan

If the evolution cluster grows beyond ~15 skills, introduce an internal event bus:

```
evolution-feedback  ──►  EvolutionEventBus  ◄──  evolution-consensus
evolution-orchestrator ──►  (in-memory pub/sub)  ◄──  evolution-memory
```

This avoids the current direct function-call coupling while preserving the synchronous pipeline semantics.

## Type Definitions

Shared types (`EvolutionProposal`, `PipelineResult`, etc.) live in `types/evolution.ts`.
Do **not** import types from sibling skill directories; always use the centralised types package.
