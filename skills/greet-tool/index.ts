/**
 * greet-tool code attachment
 * Loaded dynamically by Ouroboros as a skill extension.
 */

import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";

export const greetTool = buildTool({
  name: "greet",
  description: "Greet someone with a customizable message.",
  inputSchema: z.object({
    name: z.string(),
    language: z.enum(["en", "zh", "jp"]).default("en"),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  async call({ name, language }) {
    const greetings = {
      en: `Hello, ${name}! Welcome to Ouroboros.`,
      zh: `你好，${name}！欢迎来到衔尾蛇系统。`,
      jp: `こんにちは、${name}さん！オuroborosへようこそ。`,
    } as const;
    return { message: greetings[language as keyof typeof greetings] || greetings.en };
  },
});

export default greetTool;
