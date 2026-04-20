/**
 * Bridge Common Types
 * ===================
 * Unified interface for external knowledge/tool bridges.
 */

export interface BridgeItem {
  id: string;
  title: string;
  content: string;
  url?: string;
  source: string; // e.g. "git", "obsidian", "notion"
  tags: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface BridgeSearchResult {
  items: BridgeItem[];
  total: number;
}

export interface BridgeAdapter {
  name: string;
  enabled: boolean;
  list(limit?: number): Promise<BridgeItem[]>;
  read(id: string): Promise<BridgeItem | undefined>;
  write(item: BridgeItem): Promise<{ success: boolean; id?: string; error?: string }>;
  search(query: string, limit?: number): Promise<BridgeSearchResult>;
}
