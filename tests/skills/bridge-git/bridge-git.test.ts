import { describe, it, expect } from "vitest";
import {
  listCommits,
  readCommit,
  searchCommits,
  getEvolutionTrends,
  explainCommit,
} from "../../../skills/bridge-git/index.ts";

describe("bridge-git", () => {
  it("lists commits when in git repo", () => {
    const commits = listCommits(5);
    expect(Array.isArray(commits)).toBe(true);
    // May be empty if not in a git repo during test
  });

  it("readCommit returns undefined for fake hash", () => {
    const commit = readCommit("0000000000000000000000000000000000000000");
    expect(commit).toBeUndefined();
  });

  it("searchCommits returns empty for nonsense query", () => {
    const result = searchCommits("xyzzy-nonsense-12345", 5);
    expect(result.items.length).toBe(0);
  });

  it("getEvolutionTrends returns array", () => {
    const trends = getEvolutionTrends(7);
    expect(Array.isArray(trends)).toBe(true);
  });

  it("explainCommit handles missing hash", () => {
    const text = explainCommit("0000000000000000000000000000000000000000");
    expect(text).toContain("not found");
  });
});
