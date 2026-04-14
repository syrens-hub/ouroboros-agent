import { describe, it, expect } from "vitest";
import {
  formatOpenAIMessageContent,
  formatAnthropicContent,
  formatGeminiParts,
} from "../../core/llm-router.ts";
import type { BaseMessage } from "../../types/index.ts";

describe("LLM Router Vision Formatting", () => {
  const base64ImageBlock = {
    type: "image_url" as const,
    image_url: {
      url: "data:image/png;base64,iVBORw0KGgo=",
      detail: "auto" as const,
    },
  };

  const httpImageBlock = {
    type: "image_url" as const,
    image_url: {
      url: "https://example.com/image.png",
      detail: "high" as const,
    },
  };

  const textBlock = { type: "text" as const, text: "Hello" };

  it("formatOpenAIMessageContent preserves image_url blocks", () => {
    const content: BaseMessage["content"] = [textBlock, base64ImageBlock];
    const result = formatOpenAIMessageContent(content);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      textBlock,
      base64ImageBlock,
    ]);
  });

  it("formatOpenAIMessageContent preserves HTTP image URLs", () => {
    const content: BaseMessage["content"] = [httpImageBlock];
    const result = formatOpenAIMessageContent(content);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([httpImageBlock]);
  });

  it("formatAnthropicContent converts base64 image_url to Anthropic image block", () => {
    const content: BaseMessage["content"] = [base64ImageBlock];
    const result = formatAnthropicContent(content);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgo=",
        },
      },
    ]);
  });

  it("formatAnthropicContent preserves HTTP image URLs as text placeholders", () => {
    const content: BaseMessage["content"] = [httpImageBlock];
    const result = formatAnthropicContent(content);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      { type: "text", text: "[Image: https://example.com/image.png]" },
    ]);
  });

  it("formatGeminiParts converts base64 image_url to inlineData", () => {
    const content: BaseMessage["content"] = [base64ImageBlock];
    const result = formatGeminiParts(content);
    expect(result).toEqual([
      { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
    ]);
  });

  it("formatGeminiParts preserves HTTP image URLs as text placeholders", () => {
    const content: BaseMessage["content"] = [httpImageBlock];
    const result = formatGeminiParts(content);
    expect(result).toEqual([
      { text: "[Image: https://example.com/image.png]" },
    ]);
  });

  it("formatAnthropicContent handles mixed text and image blocks", () => {
    const content: BaseMessage["content"] = [textBlock, base64ImageBlock];
    const result = formatAnthropicContent(content);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      textBlock,
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgo=",
        },
      },
    ]);
  });

  it("formatGeminiParts handles mixed text and image blocks", () => {
    const content: BaseMessage["content"] = [textBlock, base64ImageBlock];
    const result = formatGeminiParts(content);
    expect(result).toEqual([
      { text: "Hello" },
      { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } },
    ]);
  });

  it("formatOpenAIMessageContent falls back to JSON for unknown blocks", () => {
    const content: BaseMessage["content"] = [{ foo: "bar" } as unknown as { type: "text"; text: string }];
    const result = formatOpenAIMessageContent(content);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ type: "text", text: '{"foo":"bar"}' }]);
  });
});
