/**
 * Document Processor
 * ==================
 * Parses and chunks documents for RAG ingestion.
 */

import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { safeJsonParse } from "../../core/safe-utils.ts";

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: {
    startLine?: number;
    endLine?: number;
  };
}

export interface DocumentMetadata {
  id: string;
  filename: string;
  format: string;
  size: number;
  hash: string;
  createdAt: number;
  chunkCount: number;
}

export interface ChunkingConfig {
  chunkSize?: number;
  chunkOverlap?: number;
  minChunkLength?: number;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function extractText(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  if (filePath.endsWith(".json")) {
    const parsed = safeJsonParse(content, "json document");
    if (parsed !== undefined) {
      return JSON.stringify(parsed, null, 2);
    }
    return content;
  }
  return content;
}

export function chunkMarkdown(content: string, config: Required<ChunkingConfig>): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let currentChunk = "";
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
    }

    // Start a new chunk at headings if current chunk is large enough
    const isHeading = /^#{1,6}\s+/.test(line);
    if (isHeading && !inCodeBlock && currentChunk.length >= config.chunkSize * 0.3) {
      if (currentChunk.length >= config.minChunkLength) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = line + "\n";
      continue;
    }

    currentChunk += line + "\n";

    if (currentChunk.length >= config.chunkSize) {
      chunks.push(currentChunk.trim());
      // overlap
      const overlapText = currentChunk.slice(-config.chunkOverlap);
      currentChunk = overlapText;
    }
  }

  if (currentChunk.trim().length >= config.minChunkLength) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [content];
}

export function chunkPlainText(content: string, config: Required<ChunkingConfig>): string[] {
  const paragraphs = content.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if (currentChunk.length + para.length + 2 > config.chunkSize && currentChunk.length >= config.minChunkLength) {
      chunks.push(currentChunk.trim());
      const overlapText = currentChunk.slice(-config.chunkOverlap);
      currentChunk = overlapText + "\n\n" + para;
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    }
  }

  if (currentChunk.trim().length >= config.minChunkLength || chunks.length === 0) {
    chunks.push(currentChunk.trim());
  }

  // Further split any oversized chunks
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= config.chunkSize * 1.2) {
      result.push(chunk);
      continue;
    }
    for (let i = 0; i < chunk.length; i += config.chunkSize - config.chunkOverlap) {
      const piece = chunk.slice(i, i + config.chunkSize);
      if (piece.length >= config.minChunkLength) {
        result.push(piece);
      }
    }
  }

  return result.length > 0 ? result : [content];
}

export function computeHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function processDocument(
  content: string,
  metadata: Omit<DocumentMetadata, "id" | "chunkCount" | "hash">,
  config?: ChunkingConfig
): { metadata: DocumentMetadata; chunks: DocumentChunk[] } {
  const cfg: Required<ChunkingConfig> = {
    chunkSize: config?.chunkSize ?? 1000,
    chunkOverlap: config?.chunkOverlap ?? 100,
    minChunkLength: config?.minChunkLength ?? 50,
  };

  const docId = generateId("doc");
  const hash = computeHash(content);
  const formatLower = metadata.format.toLowerCase();

  let rawChunks: string[];
  if (formatLower === "markdown" || formatLower === "md") {
    rawChunks = chunkMarkdown(content, cfg);
  } else {
    rawChunks = chunkPlainText(content, cfg);
  }

  const lines = content.split("\n");
  const chunks: DocumentChunk[] = rawChunks.map((text, idx) => {
    // Find approximate start/end lines
    const startLine = lines.findIndex((l) => text.includes(l));
    const endLine = startLine >= 0 ? Math.min(startLine + text.split("\n").length - 1, lines.length - 1) : undefined;
    return {
      id: generateId("chunk"),
      documentId: docId,
      content: text,
      chunkIndex: idx,
      metadata: {
        startLine: startLine >= 0 ? startLine : undefined,
        endLine: endLine !== undefined && endLine >= 0 ? endLine : undefined,
      },
    };
  });

  const finalMeta: DocumentMetadata = {
    ...metadata,
    id: docId,
    hash,
    chunkCount: chunks.length,
  };

  return { metadata: finalMeta, chunks };
}
