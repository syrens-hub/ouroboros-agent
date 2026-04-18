export { getEvolutionHistory, type EvolutionCommit } from "./git-history.ts";
export {
  logEvolution,
  getEvolutionLog,
  getEvolutionByCommit,
  type EvolutionRecord,
  resetMetadataDb,
} from "./metadata-store.ts";
export {
  getEvolutionMetrics,
  getEvolutionTimeSeries,
  enrichHistoryWithMetadata,
  type EvolutionMetrics,
  type TimeSeriesPoint,
} from "./metrics-aggregator.ts";
export {
  detectTrends,
  type TrendReport,
  type Anomaly,
} from "./trend-detector.ts";
