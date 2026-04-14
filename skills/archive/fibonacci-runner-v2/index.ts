import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

function fibBigInt(n: number): bigint {
  if (n < 0) throw new RangeError("n must be >= 0");
  if (n === 0) return 0n;
  if (n === 1) return 1n;
  let a = 0n;
  let b = 1n;
  for (let i = 2; i <= n; i++) {
    const tmp = a + b;
    a = b;
    b = tmp;
  }
  return b;
}

export const fibonacci_v2 = buildTool({
  name: "fibonacci_v2",
  description:
    "Compute the nth Fibonacci number (0-indexed). Supports arbitrarily large values via BigInt. Example: n=10 → 55.",
  inputSchema: z.object({
    n: z
      .number()
      .int()
      .nonnegative()
      .describe("0-indexed position in the Fibonacci sequence."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ n }) {
    try {
      const result = fibBigInt(n);
      return { n, result: result.toString() };
    } catch (err: any) {
      return { error: err?.message ?? String(err) };
    }
  },
});

export const fibonacci_sequence = buildTool({
  name: "fibonacci_sequence",
  description:
    "Compute a sequence of Fibonacci numbers from index `start` to `end` (inclusive). Max range: 1000. Example: start=0, end=7 → [0,1,1,2,3,5,8,13].",
  inputSchema: z.object({
    start: z
      .number()
      .int()
      .nonnegative()
      .describe("Start index (inclusive, 0-indexed)."),
    end: z
      .number()
      .int()
      .nonnegative()
      .describe("End index (inclusive). Must be >= start, max range 1000."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ start, end }) {
    if (end < start) {
      return { error: "`end` must be >= `start`." };
    }
    if (end - start > 1000) {
      return { error: "Range too large: maximum allowed range is 1000." };
    }
    try {
      const sequence: Array<{ index: number; value: string }> = [];
      for (let i = start; i <= end; i++) {
        sequence.push({ index: i, value: fibBigInt(i).toString() });
      }
      return { start, end, sequence };
    } catch (err: any) {
      return { error: err?.message ?? String(err) };
    }
  },
});

export default fibonacci_v2;