import type { SearchQuery, SearchResult } from "./types.ts";

/**
 * Vector Lane (MVP placeholder)
 * ==============================
 * Returns empty array. Future integration will call
 * skills/knowledge-base/ embedding search.
 */
export async function searchVectorLane(_query: SearchQuery): Promise<SearchResult[]> {
  return [];
}
