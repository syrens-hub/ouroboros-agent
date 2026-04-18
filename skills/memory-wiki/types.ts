export interface Claim {
  id: string;
  category: string;
  content: string;
  freshness: "high" | "medium" | "low" | "stale";
  status: "active" | "superseded" | "disputed";
  confidence: number; // 0.0 - 1.0
  createdAt: number;
  updatedAt: number;
  sources: EvidenceSource[];
  contradictions: string[]; // claim IDs
}

export interface EvidenceSource {
  file?: string;
  sessionId?: string;
  excerpt?: string;
  timestamp?: number;
}
