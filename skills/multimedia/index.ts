/**
 * Ouroboros Multimedia Generator Skill
 * =====================================
 * Ported from OpenClaw ClaudeFusion.
 *
 * Supports image, video, and music generation via MiniMax and other providers.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { ok } from "../../types/index.ts";

// =============================================================================
// Types
// =============================================================================

export type MediaType = "image" | "video" | "music";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";

export interface GenerationOptions {
  provider?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  duration?: number;
  resolution?: string;
  style?: string;
  negativePrompt?: string;
  lyrics?: string;
  genre?: string;
  tempo?: number;
  model?: string;
  fps?: number;
  seed?: number;
}

export interface GenerationResult {
  id: string;
  status: GenerationStatus;
  type: MediaType;
  provider: string;
  prompt: string;
  outputUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  completedAt?: number;
}

// =============================================================================
// MiniMax Provider
// =============================================================================

export class MiniMaxProvider {
  private apiKey: string;
  private baseUrl: string;
  private groupId: string;

  constructor(apiKey: string, baseUrl = "https://api.minimax.chat/v1", groupId = "") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.groupId = groupId;
  }

  async generateImage(prompt: string, options?: GenerationOptions): Promise<string> {
    const request = {
      model: "image-01",
      prompt,
      negative_prompt: options?.negativePrompt,
      resolution: options?.resolution || "1024x1024",
      style_type: options?.style,
    };
    const response = await this.makeRequest("/image_generation", request);
    const first = (response.data as Array<Record<string, unknown>> | undefined)?.[0];
    return String(first?.b64_image || first?.url || "");
  }

  async generateVideo(
    prompt: string,
    options?: GenerationOptions
  ): Promise<{ videoUrl: string; thumbnailUrl?: string }> {
    const request = {
      model: "video-01",
      prompt,
      duration: options?.duration || 6,
      resolution:
        options?.resolution === "4K"
          ? "3840x2160"
          : options?.resolution === "1080P"
          ? "1920x1080"
          : "1280x720",
    };
    const response = await this.makeRequest("/video_generation", request);
    const taskId = String(response.task_id ?? "");
    return {
      videoUrl: `minimax://task/${taskId}`,
      thumbnailUrl: String(response.video_url ?? ""),
    };
  }

  async generateMusic(prompt: string, options?: GenerationOptions): Promise<{ audioUrl: string; duration?: number }> {
    const request = {
      model: "music-01",
      prompt,
      lyrics: options?.lyrics,
      genre: options?.genre,
      duration: options?.duration || 60,
    };
    const response = await this.makeRequest("/music_generation", request);
    const first = (response.data as Array<Record<string, unknown>> | undefined)?.[0];
    return {
      audioUrl: String(first?.audio_url || ""),
      duration: first?.duration as number | undefined,
    };
  }

  async getTaskStatus(taskId: string): Promise<GenerationResult> {
    const response = await this.makeRequest("/task_status", { task_id: taskId });
    return {
      id: taskId,
      status: this.mapStatus((response.status as string | undefined) ?? ""),
      type: "video",
      provider: "minimax",
      prompt: "",
      outputUrl: String((response.video_url as string | undefined) ?? ""),
      thumbnailUrl: String((response.preview_url as string | undefined) ?? ""),
      metadata: response,
      createdAt: Date.now(),
      completedAt: (response.status as string | undefined) === "success" ? Date.now() : undefined,
    };
  }

  private async makeRequest(endpoint: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (this.groupId) {
      headers["Group-Id"] = this.groupId;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API Error: ${response.status} - ${error}`);
    }
    return response.json();
  }

  private mapStatus(status: string): GenerationStatus {
    if (["success", "completed"].includes(status)) return "completed";
    if (["failed", "error"].includes(status)) return "failed";
    if (["processing", "running"].includes(status)) return "processing";
    return "pending";
  }
}

// =============================================================================
// Multimedia Generator
// =============================================================================

export class MultimediaGenerator extends EventEmitter {
  private providers: Map<string, MiniMaxProvider> = new Map();
  private tasks: Map<string, GenerationResult> = new Map();
  private defaultProvider: string;
  private outputDir: string;

  constructor(config: { defaultProvider?: string; outputDir?: string } = {}) {
    super();
    this.defaultProvider = config.defaultProvider || "minimax";
    this.outputDir = config.outputDir || "./output/media";
  }

  addMiniMaxProvider(name: string, apiKey: string, baseUrl?: string, groupId?: string): void {
    this.providers.set(name, new MiniMaxProvider(apiKey, baseUrl, groupId));
  }

  private getProvider(name?: string): MiniMaxProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }
    return provider;
  }

  private startTask(type: MediaType, prompt: string, providerName: string): GenerationResult {
    const id = uuidv4();
    const result: GenerationResult = {
      id,
      status: "processing",
      type,
      provider: providerName,
      prompt,
      createdAt: Date.now(),
    };
    this.tasks.set(id, result);
    this.emit("generation:start", result);
    return result;
  }

  private finishTask(result: GenerationResult, updates: Partial<GenerationResult>): GenerationResult {
    Object.assign(result, updates);
    this.tasks.set(result.id, result);
    this.emit(result.status === "completed" ? "generation:complete" : "generation:failed", result);
    return result;
  }

  async generateImage(prompt: string, options?: GenerationOptions): Promise<GenerationResult> {
    const result = this.startTask("image", prompt, options?.provider || this.defaultProvider);
    try {
      const provider = this.getProvider(options?.provider);
      const imageUrl = await provider.generateImage(prompt, options);
      return this.finishTask(result, { status: "completed", outputUrl: imageUrl, completedAt: Date.now() });
    } catch (error) {
      return this.finishTask(result, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async generateVideo(prompt: string, options?: GenerationOptions): Promise<GenerationResult> {
    const result = this.startTask("video", prompt, options?.provider || this.defaultProvider);
    try {
      const provider = this.getProvider(options?.provider);
      const { videoUrl, thumbnailUrl } = await provider.generateVideo(prompt, options);
      return this.finishTask(result, {
        status: "completed",
        outputUrl: videoUrl,
        thumbnailUrl,
        metadata: { duration: options?.duration || 6 },
        completedAt: Date.now(),
      });
    } catch (error) {
      return this.finishTask(result, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async generateMusic(prompt: string, options?: GenerationOptions): Promise<GenerationResult> {
    const result = this.startTask("music", prompt, options?.provider || this.defaultProvider);
    try {
      const provider = this.getProvider(options?.provider);
      const { audioUrl, duration } = await provider.generateMusic(prompt, options);
      return this.finishTask(result, {
        status: "completed",
        outputUrl: audioUrl,
        metadata: { duration },
        completedAt: Date.now(),
      });
    } catch (error) {
      return this.finishTask(result, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  getTask(taskId: string): GenerationResult | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): GenerationResult[] {
    return Array.from(this.tasks.values());
  }

  getTasksByType(type: MediaType): GenerationResult[] {
    return this.getAllTasks().filter((task) => task.type === type);
  }

  getProcessingTasks(): GenerationResult[] {
    return this.getAllTasks().filter((task) => task.status === "processing");
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

// =============================================================================
// Agent Tools
// =============================================================================

export function createMultimediaTools(generator: MultimediaGenerator) {
  return [
    buildTool({
      name: "generate_image",
      description: "Generate an image from a text prompt using an AI image model (e.g. MiniMax).",
      inputSchema: z.object({
        prompt: z.string(),
        style: z.string().optional(),
        resolution: z.enum(["480P", "720P", "1080P", "4K"]).optional(),
      }),
      isReadOnly: true,
      isConcurrencySafe: true,
      checkPermissions: () => ok("allow"),
      async call({ prompt, style, resolution }) {
        const result = await generator.generateImage(prompt, { style, resolution });
        return {
          success: result.status === "completed",
          taskId: result.id,
          url: result.outputUrl,
          error: result.error,
        };
      },
    }),

    buildTool({
      name: "generate_video",
      description: "Generate a video from a text prompt using an AI video model (e.g. MiniMax).",
      inputSchema: z.object({
        prompt: z.string(),
        duration: z.number().optional(),
        resolution: z.enum(["480P", "720P", "1080P", "4K"]).optional(),
      }),
      isReadOnly: true,
      isConcurrencySafe: true,
      checkPermissions: () => ok("allow"),
      async call({ prompt, duration, resolution }) {
        const result = await generator.generateVideo(prompt, { duration, resolution });
        return {
          success: result.status === "completed",
          taskId: result.id,
          url: result.outputUrl,
          thumbnailUrl: result.thumbnailUrl,
          error: result.error,
        };
      },
    }),

    buildTool({
      name: "generate_music",
      description: "Generate music from a text prompt using an AI music model (e.g. MiniMax).",
      inputSchema: z.object({
        prompt: z.string(),
        lyrics: z.string().optional(),
        genre: z.string().optional(),
        duration: z.number().optional(),
      }),
      isReadOnly: true,
      isConcurrencySafe: true,
      checkPermissions: () => ok("allow"),
      async call({ prompt, lyrics, genre, duration }) {
        const result = await generator.generateMusic(prompt, { lyrics, genre, duration });
        return {
          success: result.status === "completed",
          taskId: result.id,
          url: result.outputUrl,
          metadata: result.metadata,
          error: result.error,
        };
      },
    }),
  ];
}
