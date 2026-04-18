export interface SearchQuery {
  text: string;
  filters?: {
    timeRange?: { from?: number; to?: number };
    category?: string;
    source?: string;
  };
  limit?: number;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  lane: "vector" | "keyword" | "graph" | "temporal" | "semantic";
  metadata: Record<string, unknown>;
}

export interface EngraphSearchResponse {
  results: SearchResult[];
  lanesUsed: string[];
  totalCandidates: number;
  queryTimeMs: number;
}
