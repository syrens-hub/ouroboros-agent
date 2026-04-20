/**
 * Notion Bridge
 * =============
 * Read/write Notion pages via the official REST API.
 *
 * Requires: NOTION_API_KEY environment variable
 * Optional: NOTION_DATABASE_ID for database operations
 *
 * Capabilities:
 *   - list pages from a database
 *   - read page content (blocks)
 *   - write new page to database
 *   - search pages by title
 */

import { logger } from "../../core/logger.ts";
import type { BridgeItem, BridgeSearchResult } from "../bridge-common/types.ts";

export { type BridgeItem, type BridgeSearchResult };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.NOTION_API_KEY || "";
const API_BASE = "https://api.notion.com/v1";
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

function enabled(): boolean {
  return API_KEY.length > 0;
}

async function notionFetch<T>(path: string, opts?: RequestInit): Promise<T | undefined> {
  if (!enabled()) return undefined;
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...HEADERS, ...(opts?.headers || {}) } });
    if (!res.ok) {
      logger.warn("notion:api error", { status: res.status, path });
      return undefined;
    }
    return (await res.json()) as T;
  } catch (e) {
    logger.warn("notion:fetch failed", { error: String(e), path });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// List pages
// ---------------------------------------------------------------------------

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, { title?: Array<{ plain_text: string }>; rich_text?: Array<{ plain_text: string }> }>;
  created_time: string;
  last_edited_time: string;
}

interface NotionSearchResponse {
  results: NotionPage[];
  next_cursor?: string;
  has_more: boolean;
}

export async function listPages(limit = 50): Promise<BridgeItem[]> {
  const data = await notionFetch<NotionSearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({ filter: { value: "page", property: "object" }, page_size: limit }),
  });
  if (!data) return [];

  return data.results.map((page) => ({
    id: page.id,
    title: extractTitle(page),
    content: "", // blocks fetched separately
    url: page.url,
    source: "notion",
    tags: [],
    createdAt: new Date(page.created_time).getTime(),
    updatedAt: new Date(page.last_edited_time).getTime(),
  }));
}

// ---------------------------------------------------------------------------
// Read page content
// ---------------------------------------------------------------------------

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

interface NotionBlockChildren {
  results: NotionBlock[];
}

export async function readPage(pageId: string): Promise<BridgeItem | undefined> {
  const page = await notionFetch<NotionPage>(`/pages/${pageId}`);
  if (!page) return undefined;

  const blocks = await notionFetch<NotionBlockChildren>(`/blocks/${pageId}/children`);
  const content = blocks ? blocksToMarkdown(blocks.results) : "";

  return {
    id: page.id,
    title: extractTitle(page),
    content,
    url: page.url,
    source: "notion",
    tags: [],
    createdAt: new Date(page.created_time).getTime(),
    updatedAt: new Date(page.last_edited_time).getTime(),
  };
}

// ---------------------------------------------------------------------------
// Write page
// ---------------------------------------------------------------------------

export async function writePage(databaseId: string, title: string, content: string): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!enabled()) return { success: false, error: "NOTION_API_KEY not configured" };

  try {
    const res = await notionFetch<NotionPage>("/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties: {
          Name: { title: [{ text: { content: title } }] },
        },
        children: markdownToBlocks(content),
      }),
    });

    if (!res) return { success: false, error: "Notion API returned empty response" };
    logger.info("notion:write", { pageId: res.id, title });
    return { success: true, id: res.id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchPages(query: string, limit = 20): Promise<BridgeSearchResult> {
  const data = await notionFetch<NotionSearchResponse>("/search", {
    method: "POST",
    body: JSON.stringify({ query, page_size: limit }),
  });
  if (!data) return { items: [], total: 0 };

  const items = data.results.map((page) => ({
    id: page.id,
    title: extractTitle(page),
    content: "",
    url: page.url,
    source: "notion" as const,
    tags: [],
    createdAt: new Date(page.created_time).getTime(),
    updatedAt: new Date(page.last_edited_time).getTime(),
  }));

  return { items, total: items.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTitle(page: NotionPage): string {
  const props = page.properties;
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop.title && prop.title.length > 0) return prop.title[0].plain_text;
    if (key.toLowerCase() === "name" && prop.rich_text && prop.rich_text.length > 0) {
      return prop.rich_text[0].plain_text;
    }
  }
  return "Untitled";
}

function blocksToMarkdown(blocks: NotionBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "paragraph": {
        const text = (block.paragraph as Record<string, unknown>)?.rich_text as Array<{ plain_text: string }> | undefined;
        lines.push(text?.map((t) => t.plain_text).join("") || "");
        break;
      }
      case "heading_1":
      case "heading_2":
      case "heading_3": {
        const level = parseInt(block.type.slice(-1), 10);
        const text = (block[block.type] as Record<string, unknown>)?.rich_text as Array<{ plain_text: string }> | undefined;
        lines.push(`${"#".repeat(level)} ${text?.map((t) => t.plain_text).join("") || ""}`);
        break;
      }
      case "bulleted_list_item": {
        const text = (block.bulleted_list_item as Record<string, unknown>)?.rich_text as Array<{ plain_text: string }> | undefined;
        lines.push(`- ${text?.map((t) => t.plain_text).join("") || ""}`);
        break;
      }
      case "numbered_list_item": {
        const text = (block.numbered_list_item as Record<string, unknown>)?.rich_text as Array<{ plain_text: string }> | undefined;
        lines.push(`1. ${text?.map((t) => t.plain_text).join("") || ""}`);
        break;
      }
      default:
        lines.push(`<!-- ${block.type} -->`);
    }
  }
  return lines.join("\n");
}

function markdownToBlocks(md: string): Array<{ type: string; [key: string]: unknown }> {
  const blocks: Array<{ type: string; [key: string]: unknown }> = [];
  const lines = md.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "heading_3", heading_3: { rich_text: [{ text: { content: trimmed.slice(4) } }] } });
    } else if (trimmed.startsWith("## ")) {
      blocks.push({ type: "heading_2", heading_2: { rich_text: [{ text: { content: trimmed.slice(3) } }] } });
    } else if (trimmed.startsWith("# ")) {
      blocks.push({ type: "heading_1", heading_1: { rich_text: [{ text: { content: trimmed.slice(2) } }] } });
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ text: { content: trimmed.slice(2) } }] } });
    } else if (/^\d+\.\s/.test(trimmed)) {
      blocks.push({ type: "numbered_list_item", numbered_list_item: { rich_text: [{ text: { content: trimmed.replace(/^\d+\.\s/, "") } }] } });
    } else {
      blocks.push({ type: "paragraph", paragraph: { rich_text: [{ text: { content: trimmed } }] } });
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const notionBridge = {
  name: "notion",
  get enabled() { return enabled(); },
  list: listPages,
  read: readPage,
  write: async (item: BridgeItem) => {
    const dbId = process.env.NOTION_DATABASE_ID || "";
    if (!dbId) return { success: false as const, error: "NOTION_DATABASE_ID not set" };
    return writePage(dbId, item.title, item.content);
  },
  search: searchPages,
};
