import { describe, it, expect } from "vitest";
import { maybeCompressMessages } from "../../skills/agent-loop/trajectory-utils.ts";
import type { BaseMessage } from "../../types/index.ts";

describe("trajectory-utils", () => {
  it("does not compress short message list", async () => {
    const messages: BaseMessage[] = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const result = await maybeCompressMessages(messages, 10000, 8000);
    expect(result).toEqual(messages);
  });

  it("compresses long message list", async () => {
    const messages: BaseMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "Line ".repeat(100),
    }));
    const result = await maybeCompressMessages(messages, 100, 200);
    expect(result.length).toBeLessThanOrEqual(messages.length);
  });
});
