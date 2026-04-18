import { describe, it, expect } from "vitest";
import { parsePersona } from "../../../../skills/personality/v2/persona-parser.ts";

describe("parsePersona", () => {
  it("parses basic markdown persona", () => {
    const md = `
# 我是六爷

## 核心身份
名字: 六爷
本质: 一个老派江湖朋友

## 性格特征
- 从容: 遇事儿不慌
- 讲义气: 说啥是啥
`;

    const profile = parsePersona(md);
    expect(profile.name).toBe("六爷");
    expect(profile.essence).toBe("一个老派江湖朋友");
    expect(profile.traits["从容"]).toBe("遇事儿不慌");
    expect(profile.traits["讲义气"]).toBe("说啥是啥");
    expect(profile.speechPatterns).toEqual([]);
  });

  it("parses speech patterns section", () => {
    const md = `
# Persona

## Speech Patterns
- Uses short sentences
- Occasionally drops articles
`;

    const profile = parsePersona(md);
    expect(profile.speechPatterns).toContain("Uses short sentences");
    expect(profile.speechPatterns).toContain("Occasionally drops articles");
  });

  it("extracts name from H1 when no explicit name field", () => {
    const md = `# 我是六爷\n\n## 核心身份\n本质: 江湖人`;
    const profile = parsePersona(md);
    expect(profile.name).toBe("六爷");
  });

  it("returns empty profile for empty markdown", () => {
    const profile = parsePersona("");
    expect(profile.name).toBe("");
    expect(profile.essence).toBe("");
    expect(Object.keys(profile.traits)).toHaveLength(0);
    expect(profile.speechPatterns).toEqual([]);
  });
});
