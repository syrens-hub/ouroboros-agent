/**
 * Evolution Memory
 * ================
 * Records successful and failed evolutions into the Knowledge Base
 * and retrieves similar historical proposals to guide future decisions.
 */

import type { KnowledgeBase } from "../knowledge-base/index.ts";
import type { EvolutionProposal, PipelineResult } from "../evolution-orchestrator/types.ts";

export interface EvolutionMemoryEntry {
  proposal: EvolutionProposal;
  result: PipelineResult;
  timestamp: number;
  learnedLesson: string;
}

function formatProposalAsDocument(entry: EvolutionMemoryEntry): string {
  const p = entry.proposal;
  const r = entry.result;
  return `## Evolution Record

**Files**: ${p.filesChanged.join(", ")}
**Description**: ${p.description}
**Size**: +${p.linesAdded}/-${p.linesRemoved} lines across ${p.filesChanged.length} files
**Result**: ${r.success ? "SUCCESS" : "FAILURE"} (stage: ${r.stage})
**Message**: ${r.message}
**Timestamp**: ${new Date(entry.timestamp).toISOString()}
**Lesson**: ${entry.learnedLesson}
`;
}

function buildQueryFromProposal(proposal: EvolutionProposal): string {
  return `Evolution proposal: ${proposal.description} affecting ${proposal.filesChanged.join(", ")}`;
}

/**
 * Record an evolution outcome into the Knowledge Base.
 */
export async function recordEvolutionMemory(
  kb: KnowledgeBase,
  entry: EvolutionMemoryEntry
): Promise<void> {
  const doc = formatProposalAsDocument(entry);
  const sessionId = "evolution-memory";
  await kb.ingestDocument(sessionId, doc, {
    isFile: false,
    filename: `evolution-${entry.timestamp}.md`,
    format: "md",
  });
}

/**
 * Query the Knowledge Base for similar historical evolutions.
 */
export async function queryEvolutionMemory(
  kb: KnowledgeBase,
  proposal: EvolutionProposal,
  topK = 3
): Promise<Array<{ content: string; score: number; lesson?: string }>> {
  const query = buildQueryFromProposal(proposal);
  const result = await kb.queryKnowledge("evolution-memory", query, topK);

  return result.results.map((r) => {
    const content = r.content;
    const lessonMatch = content.match(/\*\*Lesson\*\*:\s*(.+)/);
    return {
      content: content.slice(0, 500),
      score: r.score,
      lesson: lessonMatch?.[1]?.trim(),
    };
  });
}

/**
 * Generate a learned-lesson string from a pipeline result.
 */
export function deriveLesson(proposal: EvolutionProposal, result: PipelineResult): string {
  if (!result.success) {
    if (result.stage === "constitution") {
      return `Constitution violation blocked this pattern. Avoid modifying ${proposal.filesChanged.join(", ")} together.`;
    }
    if (result.stage === "budget") {
      return "Budget constraints blocked execution. Plan cheaper alternatives.";
    }
    if (result.stage === "test") {
      return "Tests failed after application. Ensure test coverage before evolving.";
    }
    return `Failed at ${result.stage}: ${result.message}`;
  }

  if (proposal.filesChanged.length > 5) {
    return `Large refactor (${proposal.filesChanged.length} files) succeeded. Consider splitting next time.`;
  }
  if ((proposal.linesAdded + proposal.linesRemoved) > 200) {
    return `Significant change succeeded. Monitor for regressions.`;
  }
  return "Standard evolution succeeded. No special lessons.";
}
