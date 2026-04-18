/**
 * Ouroboros CLI Framework
 * ========================
 * Commander/Vercel CLI-style command registry with built-in help,
 * global options, and typed argument parsing.
 */

import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CLIOption {
  readonly name: string;
  readonly short?: string;
  readonly description: string;
  readonly type: "string" | "boolean" | "number";
  readonly default?: unknown;
  readonly required?: boolean;
}

export interface CLICommand {
  readonly name: string;
  readonly description: string;
  readonly options?: readonly CLIOption[];
  readonly examples?: readonly { description: string; command: string }[];
  readonly handler: (ctx: CLIContext) => Promise<void> | void;
}

export interface CLIContext {
  readonly binName: string;
  readonly version: string;
  readonly verbose: boolean;
  readonly positional: string[];
  readonly options: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const _YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

const isTTY = process.stdout.isTTY;

function color(code: string, text: string): string {
  return isTTY ? `${code}${text}${RESET}` : text;
}

// ---------------------------------------------------------------------------
// Help renderer
// ---------------------------------------------------------------------------

function renderHelp(cmd: CLICommand, binName: string, width = 80): string {
  const lines: string[] = [];
  const indent = "  ";

  lines.push(`${color(BOLD, "USAGE")}`);
  lines.push(`  ${binName} ${color(CYAN, cmd.name)}`);

  if (cmd.description) {
    lines.push("");
    lines.push(`${color(BOLD, "DESCRIPTION")}`);
    const words = cmd.description.split(" ");
    let line = `  ${indent}${words[0] ?? ""}`;
    for (const word of words.slice(1)) {
      const test = line + " " + word;
      if (test.length > width) {
        lines.push(line);
        line = `  ${indent}${word}`;
      } else {
        line = test;
      }
    }
    if (line.trim() !== indent) lines.push(line);
  }

  if (cmd.options && cmd.options.length > 0) {
    lines.push("");
    lines.push(`${color(BOLD, "OPTIONS")}`);
    for (const opt of cmd.options) {
      const optStr = opt.short
        ? `  ${color(GREEN, `-${opt.short}`)}, ${color(GREEN, `--${opt.name}`)}`
        : `  ${color(GREEN, `--${opt.name}`)}`;
      const typeHint = opt.type !== "boolean" ? ` <${opt.type}>` : "";
      const defaultHint = opt.default !== undefined
        ? ` ${color(DIM, `[default: ${JSON.stringify(opt.default)}]`)}`
        : "";
      const required = opt.required ? ` ${color(RED, "(required)")}` : "";
      const maxDesc = width - 30;
      const desc = opt.description.length > maxDesc
        ? opt.description.slice(0, maxDesc - 3) + "..."
        : opt.description;

      lines.push(`${optStr}${color(CYAN, typeHint)}${defaultHint}${required}`);
      if (desc) lines.push(`${indent}${indent}${desc}`);
    }
  }

  if (cmd.examples && cmd.examples.length > 0) {
    lines.push("");
    lines.push(`${color(BOLD, "EXAMPLES")}`);
    for (const ex of cmd.examples) {
      lines.push(`  ${color(GRAY, "$")} ${ex.command}`);
      if (ex.description) lines.push(`${indent}${indent}${ex.description}`);
    }
  }

  return lines.join("\n");
}

function renderGlobalHelp(commands: readonly CLICommand[], binName: string, version: string): string {
  const lines: string[] = [];

  lines.push(`${color(BOLD, "USAGE")}`);
  lines.push(`  ${binName} ${color(CYAN, "<command>")} ${color(DIM, "[options]")}`);
  lines.push("");
  lines.push(`${color(BOLD, "VERSION")}`);
  lines.push(`  ${version}`);
  lines.push("");
  lines.push(`${color(BOLD, "COMMANDS")}`);

  const maxLen = Math.max(...commands.map((c) => c.name.length), 4);

  for (const cmd of commands) {
    const _padded = cmd.name.padEnd(maxLen + 2);
    lines.push(`  ${color(GREEN, cmd.name)}${" ".repeat(maxLen - cmd.name.length + 2)}${cmd.description}`);
  }

  lines.push("");
  lines.push(`${color(BOLD, "GLOBAL OPTIONS")}`);
  lines.push(`  ${color(GREEN, "-h, --help")}     Show this help message`);
  lines.push(`  ${color(GREEN, "-v, --version")}  Show version`);
  lines.push(`  ${color(GREEN, "-V, --verbose")}  Enable verbose output`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

function parseCLIOptions(
  rawOptions: Record<string, unknown>,
  options: readonly CLIOption[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const opt of options) {
    const val = rawOptions[opt.name];
    if (val !== undefined) {
      if (opt.type === "number") {
        const n = Number(val);
        if (Number.isNaN(n)) throw new Error(`Invalid number for --${opt.name}: ${val}`);
        result[opt.name] = n;
      } else if (opt.type === "boolean") {
        result[opt.name] = val === true || val === "true";
      } else {
        result[opt.name] = String(val);
      }
    } else if (opt.default !== undefined) {
      result[opt.name] = opt.default;
    }
  }

  for (const opt of options) {
    if (opt.required && result[opt.name] === undefined) {
      throw new Error(`Missing required option: --${opt.name}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI Application
// ---------------------------------------------------------------------------

export interface CLIAppOptions {
  readonly binName: string;
  readonly version: string;
  readonly description?: string;
  readonly commands: readonly CLICommand[];
  readonly defaultCommand?: string;
}

export class CLIApp {
  readonly #binName: string;
  readonly #version: string;
  readonly #commands: readonly CLICommand[];
  readonly #defaultCommand?: string;

  constructor(opts: CLIAppOptions) {
    this.#binName = opts.binName;
    this.#version = opts.version;
    this.#commands = opts.commands;
    this.#defaultCommand = opts.defaultCommand;
  }

  async run(args: string[] = process.argv.slice(2)): Promise<number> {
    // Global options only
    const globalRaw = parseArgs({
      args,
      allowPositionals: true,
      options: {
        help: { short: "h", type: "boolean" },
        version: { short: "v", type: "boolean" },
        verbose: { short: "V", type: "boolean" },
      },
    });

    const verbose = globalRaw.values.verbose === true;

    if (globalRaw.values.help) {
      const positional = globalRaw.positionals[0];
      if (positional) {
        const cmd = this.#commands.find((c) => c.name === positional);
        if (cmd) {
          console.log(renderHelp(cmd, this.#binName));
          return 0;
        }
        console.error(`${color(RED, "error")}: Unknown command '${positional}'`);
      }
      console.log(renderGlobalHelp(this.#commands, this.#binName, this.#version));
      return positional ? 1 : 0;
    }

    if (globalRaw.values.version) {
      console.log(`${this.#binName} v${this.#version}`);
      return 0;
    }

    const positional = globalRaw.positionals[0] ?? this.#defaultCommand;
    if (!positional) {
      console.error(`${color(RED, "error")}: No command specified. Run with --help for usage.`);
      return 1;
    }

    const cmd = this.#commands.find((c) => c.name === positional);
    if (!cmd) {
      console.error(`${color(RED, "error")}: Unknown command '${positional}'`);
      console.log(renderGlobalHelp(this.#commands, this.#binName, this.#version));
      return 1;
    }

    const cmdArgs = globalRaw.positionals.slice(1);
    const parseConfig: Record<string, { short?: string; type: "string" | "boolean"; default?: string | boolean }> = {};
    for (const opt of cmd.options ?? []) {
      // parseArgs only supports string/boolean; handle number manually
      parseConfig[opt.name] = {
        short: opt.short,
        type: opt.type === "number" ? "string" : opt.type,
        default: opt.default as string | boolean | undefined,
      };
    }

    const cmdRaw = parseArgs({ args: cmdArgs, allowPositionals: true, options: parseConfig as unknown as Record<string, { short?: string; type: "string" | "boolean"; default?: string | boolean }> });
    const parsedOptions = parseCLIOptions(cmdRaw.values as Record<string, unknown>, cmd.options ?? []);

    const ctx: CLIContext = {
      binName: this.#binName,
      version: this.#version,
      verbose,
      positional: cmdRaw.positionals,
      options: parsedOptions,
    };

    try {
      const result = cmd.handler(ctx);
      if (result instanceof Promise) await result;
      return 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${color(RED, "error")}: ${msg}`);
      if (verbose && err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      return 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export function stringOption(name: string, description = "", opts: Partial<Omit<CLIOption, "name" | "type" | "description">> = {}): CLIOption {
  return { name, description, type: "string", ...opts };
}

export function booleanOption(name: string, description = "", opts: Partial<Omit<CLIOption, "name" | "type" | "description">> = {}): CLIOption {
  return { name, description, type: "boolean", ...opts };
}

export function numberOption(name: string, description = "", opts: Partial<Omit<CLIOption, "name" | "type" | "description">> = {}): CLIOption {
  return { name, description, type: "number", ...opts };
}

export function example(description: string, command: string): { description: string; command: string } {
  return { description, command };
}
