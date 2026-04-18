/**
 * Style Learner
 * =============
 * Learns style dimensions from high-rated samples.
 * Dimensions: formality, verbosity, humor, technicality, empathy.
 */

import { getDb } from "../../../core/db-manager.ts";
import type { DbAdapter } from "../../../core/db-adapter.ts";
import { getStyleSamples } from "./style-sampler.ts";

export type StyleDimension = "formality" | "verbosity" | "humor" | "technicality" | "empathy";

export interface StyleProfile {
  dimensions: Record<StyleDimension, number>; // -1 to 1
  weights: Record<StyleDimension, number>; // 0 to 1, reliability
  sampleCount: number;
  updatedAt: number;
}

export interface StyleAdaptation {
  context: string;
  prompt: string;
  activeDimensions: StyleDimension[];
}

export function initStyleLearnerTables(db: DbAdapter): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS style_dimensions (
      dimension TEXT PRIMARY KEY,
      score REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
}

function ensureInitialized(): void {
  const db = getDb();
  initStyleLearnerTables(db);
}

const DIMENSION_DEFAULTS: Record<StyleDimension, number> = {
  formality: 0,
  verbosity: 0,
  humor: 0,
  technicality: 0,
  empathy: 0,
};

// Heuristic markers for each dimension
const MARKERS: Record<StyleDimension, { positive: RegExp[]; negative: RegExp[] }> = {
  formality: {
    positive: [/\b(?:please|thank you|kindly|would you|could you)\b/gi, /[;]/g, /\b(?:regards|sincerely|dear)\b/gi],
    negative: [/\b(?:hey|yo|lol|omg|wtf|gonna|wanna|gotta)\b/gi, /![!]+/g],
  },
  verbosity: {
    positive: [/[,:;]/g],
    negative: [/\b\w+\b/g], // word count is handled separately
  },
  humor: {
    positive: [/\b(?:haha|hehe|lol|😂|🤣|😄|😊| witty|ironic|sarcastic)\b/gi, /!/g],
    negative: [/\b(?:serious|strictly|formally)\b/gi],
  },
  technicality: {
    positive: [/\b(?:function|class|interface|API|database|async|await|middleware|schema|deploy|config)\b/gi,
      /[{}[\]()<>]/g],
    negative: [/\b(?:simple|easy|just|basically|simply|obviously)\b/gi],
  },
  empathy: {
    positive: [/\b(?:understand|feel|sorry|appreciate|concern|care|support|helpful)\b/gi,
      /\?/g],
    negative: [/\b(?:whatever|doesn't matter|not my problem|tough)\b/gi],
  },
};

function analyzeText(text: string): Record<StyleDimension, number> {
  const scores: Record<string, number> = {};
  const len = Math.max(1, text.length);
  const words = text.split(/\s+/).length;

  for (const [dim, markers] of Object.entries(MARKERS) as [StyleDimension, typeof MARKERS[StyleDimension]][]) {
    let posCount = 0;
    let negCount = 0;
    for (const re of markers.positive) {
      posCount += (text.match(re) || []).length;
    }
    for (const re of markers.negative) {
      negCount += (text.match(re) || []).length;
    }

    // Normalize by text length
    let score = (posCount - negCount) / Math.max(1, len / 100);
    // Special case: verbosity uses word count
    if (dim === "verbosity") {
      score = words > 30 ? 0.5 : words < 10 ? -0.5 : 0;
    }
    scores[dim] = Math.max(-1, Math.min(1, score));
  }

  return scores as Record<StyleDimension, number>;
}

export function learnFromSamples(minRating = 4): StyleProfile {
  ensureInitialized();
  const db = getDb();
  const samples = getStyleSamples(50).filter((s) => s.rating >= minRating);

  if (samples.length === 0) {
    const emptyProfile: StyleProfile = {
      dimensions: { ...DIMENSION_DEFAULTS },
      weights: { formality: 0, verbosity: 0, humor: 0, technicality: 0, empathy: 0 },
      sampleCount: 0,
      updatedAt: Date.now(),
    };
    return emptyProfile;
  }

  const dimSums: Record<StyleDimension, number> = { ...DIMENSION_DEFAULTS };
  for (const sample of samples) {
    const scores = analyzeText(sample.message);
    for (const dim of Object.keys(scores) as StyleDimension[]) {
      dimSums[dim] += scores[dim] * (sample.rating / 5);
    }
  }

  const dimensions: Record<StyleDimension, number> = { ...DIMENSION_DEFAULTS };
  const weights: Record<StyleDimension, number> = { formality: 0, verbosity: 0, humor: 0, technicality: 0, empathy: 0 };

  for (const dim of Object.keys(dimSums) as StyleDimension[]) {
    const avg = dimSums[dim] / samples.length;
    dimensions[dim] = Math.round(avg * 100) / 100;
    // Weight increases with sample count, caps at 0.9
    weights[dim] = Math.min(0.9, Math.round((samples.length / 20) * 100) / 100);

    db.prepare(
      `INSERT OR REPLACE INTO style_dimensions (dimension, score, weight, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run(dim, dimensions[dim], weights[dim], Date.now());
  }

  return {
    dimensions,
    weights,
    sampleCount: samples.length,
    updatedAt: Date.now(),
  };
}

export function getStyleProfile(): StyleProfile {
  ensureInitialized();
  const db = getDb();
  const rows = db.prepare(
    `SELECT dimension, score, weight, updated_at FROM style_dimensions`
  ).all() as unknown[];

  const dimensions: Record<StyleDimension, number> = { ...DIMENSION_DEFAULTS };
  const weights: Record<StyleDimension, number> = { formality: 0, verbosity: 0, humor: 0, technicality: 0, empathy: 0 };
  let updatedAt = Date.now();
  let count = 0;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const dim = String(r.dimension) as StyleDimension;
    if (dim in dimensions) {
      dimensions[dim] = Number(r.score);
      weights[dim] = Number(r.weight);
      updatedAt = Math.min(updatedAt, Number(r.updated_at));
      count++;
    }
  }

  return {
    dimensions,
    weights,
    sampleCount: count,
    updatedAt,
  };
}

export function adaptStyle(context: string): StyleAdaptation {
  const profile = getStyleProfile();
  const activeDimensions: StyleDimension[] = [];
  const directives: string[] = [];

  // Context-aware overrides
  const isTechnical = /\b(?:code|bug|error|debug|refactor|test|API|database)\b/i.test(context);
  const isCasual = /\b(?:chat|fun|joke|relax|hello|hi)\b/i.test(context);
  const isUrgent = /\b(?:urgent|asap|critical|broken|down|fail)\b/i.test(context);
  const isEmotional = /\b(?:sad|worried|frustrated|stuck|help)\b/i.test(context);

  for (const dim of Object.keys(profile.dimensions) as StyleDimension[]) {
    const score = profile.dimensions[dim];
    const weight = profile.weights[dim];
    if (weight < 0.2) continue;

    switch (dim) {
      case "formality": {
        if (isCasual && score > 0.3) {
          directives.push("Keep it casual and friendly.");
          activeDimensions.push(dim);
        } else if (!isCasual && score > 0.3) {
          directives.push("Maintain a professional and respectful tone.");
          activeDimensions.push(dim);
        }
        break;
      }
      case "verbosity": {
        if (isUrgent && score > 0.2) {
          directives.push("Be concise — get to the point quickly.");
          activeDimensions.push(dim);
        } else if (score > 0.3) {
          directives.push("Provide detailed explanations with context.");
          activeDimensions.push(dim);
        } else if (score < -0.3) {
          directives.push("Be brief and to the point.");
          activeDimensions.push(dim);
        }
        break;
      }
      case "humor": {
        if (score > 0.3 && !isUrgent && !isEmotional) {
          directives.push("A touch of wit is welcome when appropriate.");
          activeDimensions.push(dim);
        }
        break;
      }
      case "technicality": {
        if (isTechnical || score > 0.4) {
          directives.push("Use precise technical terminology where it helps clarity.");
          activeDimensions.push(dim);
        } else if (score < -0.3) {
          directives.push("Explain in plain language, avoid jargon.");
          activeDimensions.push(dim);
        }
        break;
      }
      case "empathy": {
        if (isEmotional || score > 0.3) {
          directives.push("Show understanding and offer reassurance.");
          activeDimensions.push(dim);
        }
        break;
      }
    }
  }

  if (directives.length === 0) {
    directives.push("Respond naturally and helpfully.");
  }

  return {
    context,
    prompt: directives.join("\n"),
    activeDimensions,
  };
}
