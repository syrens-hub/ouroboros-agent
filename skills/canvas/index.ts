/// <reference lib="dom" />
import { z } from "zod";
import { buildTool } from "../../core/tool-framework.ts";
import { ok } from "../../types/index.ts";
import type { Browser, Page } from "playwright-core";

export interface CanvasConfig {
  width?: number;
  height?: number;
  backgroundColor?: string;
}

export type CanvasCommand = {
  type: "rect" | "circle" | "text" | "image";
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fill?: string;
  src?: string;
};

export class CanvasWorkspace {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private config: Required<CanvasConfig>;

  constructor(config?: CanvasConfig) {
    this.config = {
      width: config?.width ?? 800,
      height: config?.height ?? 600,
      backgroundColor: config?.backgroundColor ?? "#ffffff",
    };
  }

  async draw(commands: CanvasCommand[]): Promise<string> {
    const { chromium } = await import("playwright-core");
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    if (!this.page) {
      const context = await this.browser.newContext();
      this.page = await context.newPage();
    }

    const { width, height, backgroundColor } = this.config;

    await this.page.setContent(`
      <!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;">
          <canvas id="c" width="${width}" height="${height}"></canvas>
        </body>
      </html>
    `);

    const dataUrl = await this.page.evaluate(
      (args) => {
        const { commands, backgroundColor, width, height } = args;
        const canvas = document.getElementById("c") as HTMLCanvasElement;
        const ctx = canvas.getContext("2d")!;

        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        for (const cmd of commands) {
          ctx.fillStyle = cmd.fill ?? "#000000";
          switch (cmd.type) {
            case "rect":
              ctx.fillRect(cmd.x, cmd.y, cmd.width ?? 100, cmd.height ?? 100);
              break;
            case "circle":
              ctx.beginPath();
              ctx.arc(
                cmd.x,
                cmd.y,
                (cmd.width ?? 100) / 2,
                0,
                Math.PI * 2
              );
              ctx.fill();
              break;
            case "text":
              ctx.fillText(cmd.text ?? "", cmd.x, cmd.y);
              break;
            case "image":
              // Images loaded via drawImage would require additional async handling.
              // Stubbed here for command completeness.
              break;
          }
        }

        return canvas.toDataURL("image/png");
      },
      { commands, backgroundColor, width, height }
    );

    return dataUrl;
  }

  async export(format: "png" | "svg"): Promise<string> {
    if (format === "png") {
      return this.draw([]);
    }
    throw new Error("SVG export not implemented");
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

export const canvas_draw = buildTool({
  name: "canvas_draw",
  description: "Draw shapes and text on an HTML canvas and return a PNG data URL.",
  inputSchema: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    commands: z.array(
      z.object({
        type: z.enum(["rect", "circle", "text", "image"]),
        x: z.number(),
        y: z.number(),
        width: z.number().optional(),
        height: z.number().optional(),
        text: z.string().optional(),
        fill: z.string().optional(),
        src: z.string().optional(),
      })
    ),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  costProfile: { latency: "fast", cpuIntensity: "medium", externalCost: "none" },
  checkPermissions: () => ok("allow"),
  async call({ width, height, commands }) {
    const workspace = new CanvasWorkspace({ width, height });
    try {
      const dataUrl = await workspace.draw(commands);
      return { success: true, dataUrl };
    } finally {
      await workspace.close();
    }
  },
});

export const canvas_export = buildTool({
  name: "canvas_export",
  description: "Export the current canvas as a PNG data URL.",
  inputSchema: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
  }),
  isReadOnly: true,
  isConcurrencySafe: true,
  costProfile: { latency: "fast", cpuIntensity: "low", externalCost: "none" },
  checkPermissions: () => ok("allow"),
  async call({ width, height }) {
    const workspace = new CanvasWorkspace({ width, height });
    try {
      const dataUrl = await workspace.export("png");
      return { success: true, dataUrl };
    } finally {
      await workspace.close();
    }
  },
});
