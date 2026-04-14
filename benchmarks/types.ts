export interface BenchmarkResult {
  name: string;
  metrics: Record<string, number>;
  details: unknown[];
  timestamp: number;
}
