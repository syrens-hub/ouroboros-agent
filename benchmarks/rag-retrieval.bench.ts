import { appConfig } from "../core/config.ts";
import { resetDbSingleton } from "../core/db-manager.ts";
import { join } from "path";
import { rmSync, existsSync } from "fs";
import type { BenchmarkResult } from "./types.ts";

const TEST_DB_DIR = join(process.cwd(), ".ouroboros", "benchmark-rag-db");

async function getKnowledgeBase() {
  appConfig.db.dir = TEST_DB_DIR;
  resetDbSingleton();
  const { KnowledgeBase } = await import("../skills/knowledge-base/index.ts");
  return new KnowledgeBase({ embedding: { provider: "local" } });
}

export async function runRAGRetrievalBenchmark(): Promise<BenchmarkResult> {
  const kb = await getKnowledgeBase();
  const sessionId = "bench-rag-session";
  const docIds: string[] = [];
  const details: Array<{ query: string; latencyMs: number; recallAt3: number }> = [];

  const docs = [
    {
      id: "doc-1",
      content:
        "The Python programming language was created by Guido van Rossum and first released in 1991.",
    },
    {
      id: "doc-2",
      content:
        "TypeScript is a strongly typed programming language that builds on JavaScript, giving you better tooling at any scale.",
    },
    {
      id: "doc-3",
      content:
        "Rust is a systems programming language that runs blazingly fast, prevents segfaults, and guarantees thread safety.",
    },
    {
      id: "doc-4",
      content:
        "Go, also known as Golang, is an open source programming language developed by Google.",
    },
    {
      id: "doc-5",
      content:
        "Zig is a general-purpose programming language and build system that aims to be robust and optimal.",
    },
  ];

  try {
    for (const doc of docs) {
      const result = await kb.ingestDocument(sessionId, doc.content, {
        isFile: false,
        filename: `${doc.id}.txt`,
      });
      if (result.success && result.documentId) {
        docIds.push(result.documentId);
      }
    }

    const queries = [
      { query: "Who created Python?", expectedDocIndex: 0 },
      { query: "What is TypeScript?", expectedDocIndex: 1 },
      { query: "Rust guarantees thread safety", expectedDocIndex: 2 },
    ];

    let totalLatency = 0;
    let totalRecall = 0;

    for (const q of queries) {
      const start = performance.now();
      const result = await kb.queryKnowledge(sessionId, q.query, 3);
      const latencyMs = performance.now() - start;
      totalLatency += latencyMs;

      const expectedDocId = docIds[q.expectedDocIndex];
      const top3Ids = result.results.slice(0, 3).map((r) => (r.metadata?.documentId as string) || "");
      const recallAt3 = expectedDocId && top3Ids.includes(expectedDocId) ? 1 : 0;
      totalRecall += recallAt3;

      details.push({ query: q.query, latencyMs, recallAt3 });
    }

    return {
      name: "rag-retrieval",
      metrics: {
        recall_at_3: totalRecall / queries.length,
        avg_latency_ms: totalLatency / queries.length,
        total_latency_ms: totalLatency,
      },
      details,
      timestamp: Date.now(),
    };
  } finally {
    for (const docId of docIds) {
      try {
        kb.deleteDocument(sessionId, docId);
      } catch {
        // ignore cleanup errors
      }
    }
    try {
      resetDbSingleton();
      if (existsSync(TEST_DB_DIR)) {
        rmSync(TEST_DB_DIR, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}
