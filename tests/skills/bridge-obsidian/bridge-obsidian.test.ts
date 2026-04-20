import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  listNotes,
  readNote,
  writeNote,
  searchNotes,
} from "../../../skills/bridge-obsidian/index.ts";

describe("bridge-obsidian", () => {
  let tempVault: string;

  beforeEach(() => {
    tempVault = mkdtempSync(join(tmpdir(), "obsidian-test-"));
    process.env.OBSIDIAN_VAULT_PATH = tempVault;
  });

  it("lists notes from vault", () => {
    writeFileSync(join(tempVault, "test.md"), "# Hello\n\nWorld content", "utf-8");
    const notes = listNotes(10);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0].title).toBe("test");
  });

  it("reads a note", () => {
    writeFileSync(join(tempVault, "read.md"), "---\ntitle: My Note\n---\n\nBody text", "utf-8");
    const note = readNote("read.md");
    expect(note).toBeDefined();
    expect(note!.title).toBe("My Note");
    expect(note!.content).toContain("Body text");
  });

  it("writes a note", () => {
    const result = writeNote("new.md", "New Note", "This is content", ["tag1"]);
    expect(result.success).toBe(true);

    const read = readNote("new.md");
    expect(read).toBeDefined();
    expect(read!.title).toBe("New Note");
  });

  it("searches notes", () => {
    writeFileSync(join(tempVault, "a.md"), "Apple pie recipe", "utf-8");
    writeFileSync(join(tempVault, "b.md"), "Banana bread", "utf-8");
    const result = searchNotes("Apple", 10);
    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe("a");
  });
});
