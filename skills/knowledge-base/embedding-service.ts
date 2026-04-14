export type EmbeddingProvider = "local" | "openai" | "minimax" | "xenova";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

export interface EmbeddingVector {
  values: number[];
  dimensions: number;
}

function normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) return vec;
  return vec.map((v) => v / magnitude);
}

// Lightweight fallback embedding: character trigram frequency vector (256 dims)
function charTrigramEmbedding(text: string): number[] {
  const vec = new Array(256).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < normalized.length - 2; i++) {
    const tri = normalized.slice(i, i + 3);
    let hash = 0;
    for (let j = 0; j < tri.length; j++) {
      hash = (hash * 31 + tri.charCodeAt(j)) % 256;
    }
    vec[hash] += 1;
  }
  return normalize(vec);
}

class LRUCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first item in Map)
      const first = this.cache.keys().next();
      if (!first.done && first.value !== undefined) {
        this.cache.delete(first.value);
      }
    }
    this.cache.set(key, value);
  }
}

let xenovaPipeline: unknown | null = null;

async function getXenovaPipeline(model: string) {
  if (!xenovaPipeline) {
    const { pipeline } = await import("@xenova/transformers");
    xenovaPipeline = await pipeline("feature-extraction", model, {
      quantized: false, // use full-precision for better quality
    });
  }
  return xenovaPipeline as (texts: string | string[], options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] } | Array<{ data: Float32Array; dims: number[] }>>;
}

export class EmbeddingService {
  private config: EmbeddingConfig;
  private cache = new LRUCache<string, EmbeddingVector>(1000);

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const cached = this.cache.get(text);
    if (cached) return cached;
    const values = await this.embedText(text);
    const result = { values, dimensions: values.length };
    this.cache.set(text, result);
    return result;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    if (this.config.provider === "xenova" && texts.length > 1) {
      const model = this.config.model ?? "Xenova/all-MiniLM-L6-v2";
      const extractor = await getXenovaPipeline(model);
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const results = Array.isArray(output) ? output : [output];
      return results.map((r) => ({ values: Array.from(r.data), dimensions: r.dims[r.dims.length - 1] ?? r.data.length }));
    }
    const results = await Promise.all(texts.map((t) => this.embed(t)));
    return results;
  }

  private async embedText(text: string): Promise<number[]> {
    switch (this.config.provider) {
      case "local": {
        return charTrigramEmbedding(text);
      }
      case "xenova": {
        const model = this.config.model ?? "Xenova/all-MiniLM-L6-v2";
        const extractor = await getXenovaPipeline(model);
        const output = await extractor(text, { pooling: "mean", normalize: true });
        const result = Array.isArray(output) ? output[0] : output;
        return Array.from(result.data);
      }
      case "openai": {
        const apiKey = this.config.apiKey;
        if (!apiKey) {
          throw new Error("OpenAI provider requires an apiKey");
        }
        const model = this.config.model ?? "text-embedding-3-small";
        const response = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            input: text,
            model,
          }),
        });
        if (!response.ok) {
          throw new Error(
            `OpenAI embedding request failed: ${response.status} ${await response.text()}`
          );
        }
        const data = (await response.json()) as {
          data: { embedding: number[] }[];
        };
        const embedding = data.data[0]?.embedding;
        if (!embedding) {
          throw new Error("OpenAI embedding response did not contain an embedding");
        }
        return normalize(embedding);
      }
      case "minimax": {
        const apiKey = this.config.apiKey;
        if (!apiKey) {
          throw new Error("Minimax provider requires an apiKey");
        }
        const baseUrl = this.config.baseUrl ?? "https://api.minimax.chat/v1";
        const model = this.config.model ?? "embo-01";
        const response = await fetch(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            text,
            model,
            type: "db",
          }),
        });
        if (!response.ok) {
          throw new Error(
            `Minimax embedding request failed: ${response.status} ${await response.text()}`
          );
        }
        const data = (await response.json()) as {
          data: { embedding: number[] }[];
        };
        const embedding = data.data[0]?.embedding;
        if (!embedding) {
          throw new Error("Minimax embedding response did not contain an embedding");
        }
        return normalize(embedding);
      }
      default: {
        throw new Error(`Unknown provider: ${this.config.provider}`);
      }
    }
  }
}
