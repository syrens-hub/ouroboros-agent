import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

export const base64Encode = buildTool({
  name: "base64_encode",
  description: "Encode a plain text string into base64. Example: 'hello' → 'aGVsbG8='",
  inputSchema: z.object({
    input: z.string().describe("The plain text string to encode as base64."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ input }) {
    try {
      const encoded = Buffer.from(input, "utf8").toString("base64");
      return { encoded };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`base64_encode failed: ${message}`);
    }
  },
});

export const base64Decode = buildTool({
  name: "base64_decode",
  description: "Decode a base64 string back to plain text. Example: 'aGVsbG8=' → 'hello'",
  inputSchema: z.object({
    input: z.string().describe("The base64-encoded string to decode."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ input }) {
    try {
      // Validate that the input looks like valid base64
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      const stripped = input.replace(/\s/g, "");
      if (!base64Regex.test(stripped)) {
        throw new Error("Input does not appear to be valid base64.");
      }
      const decoded = Buffer.from(stripped, "base64").toString("utf8");
      return { decoded };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`base64_decode failed: ${message}`);
    }
  },
});

export default base64Encode;