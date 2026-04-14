import { describe, it, expect } from "vitest";
import {
  processDocument,
  chunkMarkdown,
  chunkPlainText,
  computeHash,
  extractText,
} from "../../../skills/knowledge-base/document-processor.ts";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("DocumentProcessor", () => {
  it("chunks markdown preserving headings", () => {
    const md = "# Title\n\nParagraph 1.\n\n## Section\n\nParagraph 2.\n\n### Subsection\n\nParagraph 3.";
    const chunks = chunkMarkdown(md, { chunkSize: 200, chunkOverlap: 20, minChunkLength: 10 });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]).toContain("# Title");
  });

  it("chunks plain text with overlap", () => {
    const text = "word ".repeat(500);
    const chunks = chunkPlainText(text, { chunkSize: 300, chunkOverlap: 30, minChunkLength: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap check: last 30 chars of chunk 0 should appear at start of chunk 1
    const overlap = chunks[0].slice(-30);
    expect(chunks[1].startsWith(overlap)).toBe(true);
  });

  it("processDocument returns metadata and chunks", () => {
    const content = "# Hello\n\nThis is a test document.\n\nIt has multiple paragraphs.";
    const result = processDocument(content, {
      filename: "test.md",
      format: "markdown",
      size: content.length,
      createdAt: Date.now(),
    });
    expect(result.metadata.filename).toBe("test.md");
    expect(result.metadata.chunkCount).toBe(result.chunks.length);
    expect(result.chunks[0].documentId).toBe(result.metadata.id);
    expect(result.metadata.hash).toBeDefined();
  });

  it("computeHash is deterministic", () => {
    const h1 = computeHash("hello");
    const h2 = computeHash("hello");
    expect(h1).toBe(h2);
    expect(h1.length).toBe(16);
  });

  it("extractText reads files and flattens JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ouroboros-kb-"));
    const txtPath = join(dir, "a.txt");
    const jsonPath = join(dir, "b.json");
    writeFileSync(txtPath, "plain text");
    writeFileSync(jsonPath, JSON.stringify({ key: "value" }));

    expect(extractText(txtPath)).toBe("plain text");
    expect(extractText(jsonPath)).toContain('"key": "value"');

    rmSync(dir, { recursive: true });
  });
});
