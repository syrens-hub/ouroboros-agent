import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

export const fibonacci = buildTool({
  name: "fibonacci",
  description:
    "Compute the nth Fibonacci number (0-indexed). Example: n=10 → 55.",
  inputSchema: z.object({
    n: z
      .number()
      .int()
      .nonnegative()
      .describe("The 0-based index of the Fibonacci number to compute."),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ n }) {
    if (n === 0) return { n, result: "0" };
    if (n === 1) return { n, result: "1" };

    let prev = BigInt(0);
    let curr = BigInt(1);

    for (let i = 2; i <= n; i++) {
      const next = prev + curr;
      prev = curr;
      curr = next;
    }

    return { n, result: curr.toString() };
  },
});

export default fibonacci;