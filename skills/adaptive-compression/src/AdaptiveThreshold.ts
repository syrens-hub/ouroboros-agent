/**
 * Adaptive Threshold Calculator
 * Computes compression thresholds based on conversation complexity.
 *
 * Design: Fully deterministic (no Math.random())
 * Uses total's lowest 8 bits as jitter source: 0-255 → [0, 0.03)
 */

import type {
  ComplexityScore,
  AdaptiveThreshold,
  AdaptiveCompressorConfig,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// Complexity tier boundaries
const HIGH_THRESHOLD = 500_000;
const MEDIUM_THRESHOLD = 200_000;

// Strategy-specific ratio ranges
const AGGRESSIVE_RATIO_MIN = 0.15;
const AGGRESSIVE_RATIO_MAX = 0.18;
const NORMAL_RATIO_MIN = 0.20;
const NORMAL_RATIO_MAX = 0.24;
const CONSERVATIVE_RATIO_MIN = 0.25;
const CONSERVATIVE_RATIO_MAX = 0.35;

// Code-intensive multiplier cap
const CODE_INTENSIVE_MULTIPLIER = 1.5;
const CODE_INTENSIVE_CAP = 0.35;

// Code density thresholds
const CODE_BLOCK_THRESHOLD = 50;
const FILE_COUNT_THRESHOLD = 20;

export class AdaptiveThresholdCalculator {
  private config: AdaptiveCompressorConfig;

  constructor(config: Partial<AdaptiveCompressorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute adaptive thresholds based on complexity.
   *
   * Strategy selection:
   * - HIGH (>500k): aggressive, keep 15-18%
   * - MEDIUM (200k-500k): normal, keep 20-24%
   * - LOW (<200k): conservative, keep 25-35%
   *
   * Code-intensive boost:
   * - If codeBlockCount > 50 OR uniqueFileCount > 20
   * - Keep more context, multiplier capped at 0.35
   *
   * Deterministic jitter:
   * - Uses total's lowest 8 bits as pseudo-random source
   * - Range: [0, 0.03) for aggressive tier
   */
  computeThreshold(complexity: ComplexityScore): AdaptiveThreshold {
    const { total, codeBlockCount, uniqueFileCount, errorDensity } = complexity;

    // Determine base compression ratio based on complexity tier
    let compressionRatio: number;
    let strategy: "aggressive" | "normal" | "conservative";

    if (total > HIGH_THRESHOLD) {
      // HIGH: 15-18%, deterministic jitter from total bits
      const jitter = this.extractDeterministicJitter(total, AGGRESSIVE_RATIO_MAX - AGGRESSIVE_RATIO_MIN);
      compressionRatio = AGGRESSIVE_RATIO_MIN + jitter;
      strategy = "aggressive";
    } else if (total > MEDIUM_THRESHOLD) {
      // MEDIUM: linear interpolation 20-24%
      const t = (total - MEDIUM_THRESHOLD) / (HIGH_THRESHOLD - MEDIUM_THRESHOLD);
      compressionRatio = NORMAL_RATIO_MIN + t * (NORMAL_RATIO_MAX - NORMAL_RATIO_MIN);
      strategy = "normal";
    } else {
      // LOW: linear interpolation 25-35%
      const t = (MEDIUM_THRESHOLD - total) / MEDIUM_THRESHOLD;
      compressionRatio = CONSERVATIVE_RATIO_MIN + t * (CONSERVATIVE_RATIO_MAX - CONSERVATIVE_RATIO_MIN);
      strategy = "conservative";
    }

    // Code-intensive conversations need more context preserved
    if (codeBlockCount > CODE_BLOCK_THRESHOLD || uniqueFileCount > FILE_COUNT_THRESHOLD) {
      compressionRatio = Math.min(compressionRatio * CODE_INTENSIVE_MULTIPLIER, CODE_INTENSIVE_CAP);
    }

    // Warning threshold scales with error density
    const warningMultiplier = 1 + errorDensity * 2;
    const warningThreshold = Math.round(
      this.config.baseWarningThreshold * warningMultiplier
    );

    // Target tokens based on compression ratio
    const targetTokens = Math.round(
      this.config.baseTargetTokens * (compressionRatio / 0.4) // Normalize to base ratio
    );

    return {
      warningThreshold,
      targetTokens,
      compressionRatio,
      strategy,
    };
  }

  /**
   * Extract deterministic jitter from a number's lowest bits.
   * Range: [0, maxJitter)
   *
   * Uses low bits because they tend to have better distribution
   * across different input ranges compared to high bits.
   */
  private extractDeterministicJitter(value: number, maxJitter: number): number {
    const lowBits = value & 0xff; // Extract lowest 8 bits
    return (lowBits / 0xff) * maxJitter;
  }

  /**
   * Quick check if compression should be triggered.
   * Uses simple token estimate without full complexity scan.
   */
  shouldTriggerCompression(
    totalTokens: number,
    config?: Partial<AdaptiveCompressorConfig>
  ): boolean {
    const threshold = config?.baseWarningThreshold ?? this.config.baseWarningThreshold;
    return totalTokens >= threshold;
  }

  /**
   * Get strategy description for logging.
   */
  getStrategyDescription(threshold: AdaptiveThreshold): string {
    const { strategy, compressionRatio, targetTokens, warningThreshold } = threshold;
    return (
      `[${strategy.toUpperCase()}] ratio=${compressionRatio.toFixed(3)}, ` +
      `target=${targetTokens}, warning=${warningThreshold}`
    );
  }
}
