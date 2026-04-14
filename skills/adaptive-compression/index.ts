/**
 * Adaptive Compression Skill
 *
 * Tools:
 * - assess_compression: Analyze complexity and determine compression need
 * - compact_conversation: Compact with quality-guaranteed summary
 * - log_compression: Log compression assessment for debugging
 *
 * Usage in agent conversations:
 *   import { getTools } from "openclaw-workspace:adaptive-compression";
 */

export { AdaptiveCompressorEngine } from "./src/AdaptiveCompressorEngine.js";
export {
  ASSESS_COMPRESSION_SCHEMA,
  COMPACT_CONVERSATION_SCHEMA,
  LOG_COMPRESSION_SCHEMA,
  assessCompression,
  compactConversation,
  logCompression,
} from "./src/skill-tools.js";
