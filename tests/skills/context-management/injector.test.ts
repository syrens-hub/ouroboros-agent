import { describe, it, expect, beforeEach } from "vitest";
import {
  ContextInjector,
  type InjectionItem,
} from "../../../skills/context-management/injector.ts";

describe("ContextInjector", () => {
  let injector: ContextInjector;

  beforeEach(() => {
    injector = new ContextInjector();
  });

  it("performs basic injection", () => {
    const item: InjectionItem = {
      id: "sys-1",
      content: "System prompt",
      tokenCount: 10,
      priority: 1,
      enabled: true,
      point: "system",
    };

    injector.addInjection(item);
    const result = injector.inject({}, 100);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: "system", content: "System prompt" });
    expect(result.totalTokens).toBe(10);
    expect(result.injectedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
  });

  it("creates user messages for non-system injection points", () => {
    const item: InjectionItem = {
      id: "ctx-1",
      content: "Context hint",
      tokenCount: 5,
      priority: 1,
      enabled: true,
      point: "pre_user",
    };

    injector.addInjection(item);
    const result = injector.inject({}, 100);

    expect(result.messages[0]).toEqual({
      role: "user",
      name: "context_injector",
      content: "Context hint",
    });
  });

  it("orders injections by priority descending", () => {
    const low: InjectionItem = {
      id: "low",
      content: "Low priority",
      tokenCount: 1,
      priority: 1,
      enabled: true,
      point: "system",
    };
    const high: InjectionItem = {
      id: "high",
      content: "High priority",
      tokenCount: 1,
      priority: 10,
      enabled: true,
      point: "system",
    };
    const mid: InjectionItem = {
      id: "mid",
      content: "Mid priority",
      tokenCount: 1,
      priority: 5,
      enabled: true,
      point: "system",
    };

    injector.addInjection(low);
    injector.addInjection(high);
    injector.addInjection(mid);

    const result = injector.inject({}, 100);
    const contents = result.messages.map((m) =>
      typeof m.content === "string" ? m.content : ""
    );

    expect(contents).toEqual(["High priority", "Mid priority", "Low priority"]);
  });

  it("respects maxFrequency default of 1 (inject once ever)", () => {
    const item: InjectionItem = {
      id: "once",
      content: "One time",
      tokenCount: 2,
      priority: 1,
      enabled: true,
      point: "system",
    };

    injector.addInjection(item);

    const first = injector.inject({}, 100);
    expect(first.injectedCount).toBe(1);

    const second = injector.inject({}, 100);
    expect(second.injectedCount).toBe(0);
    expect(second.skippedCount).toBe(1);
  });

  it("respects maxFrequency of 0 (unlimited injections)", () => {
    const item: InjectionItem = {
      id: "unlimited",
      content: "Always",
      tokenCount: 2,
      priority: 1,
      enabled: true,
      point: "system",
      maxFrequency: 0,
    };

    injector.addInjection(item);

    const first = injector.inject({}, 100);
    expect(first.injectedCount).toBe(1);

    const second = injector.inject({}, 100);
    expect(second.injectedCount).toBe(1);
    expect(second.skippedCount).toBe(0);
  });

  it("respects custom maxFrequency > 1", () => {
    const item: InjectionItem = {
      id: "limited",
      content: "Limited",
      tokenCount: 2,
      priority: 1,
      enabled: true,
      point: "system",
      maxFrequency: 2,
    };

    injector.addInjection(item);

    expect(injector.inject({}, 100).injectedCount).toBe(1);
    expect(injector.inject({}, 100).injectedCount).toBe(1);
    expect(injector.inject({}, 100).injectedCount).toBe(0);
    expect(injector.inject({}, 100).skippedCount).toBe(1);
  });

  it("filters by condition", () => {
    const item: InjectionItem = {
      id: "conditional",
      content: "Conditional",
      tokenCount: 2,
      priority: 1,
      enabled: true,
      point: "system",
      condition: (state) => (state as { active: boolean }).active === true,
    };

    injector.addInjection(item);

    const inactive = injector.inject({ active: false }, 100);
    expect(inactive.messages).toHaveLength(0);
    expect(inactive.skippedCount).toBe(0);

    const active = injector.inject({ active: true }, 100);
    expect(active.messages).toHaveLength(1);
    expect(active.injectedCount).toBe(1);
  });

  it("enforces maxTokens cutoff", () => {
    const a: InjectionItem = {
      id: "a",
      content: "A",
      tokenCount: 5,
      priority: 3,
      enabled: true,
      point: "system",
    };
    const b: InjectionItem = {
      id: "b",
      content: "B",
      tokenCount: 5,
      priority: 2,
      enabled: true,
      point: "system",
    };
    const c: InjectionItem = {
      id: "c",
      content: "C",
      tokenCount: 5,
      priority: 1,
      enabled: true,
      point: "system",
    };

    injector.addInjection(a);
    injector.addInjection(b);
    injector.addInjection(c);

    const result = injector.inject({}, 12);

    expect(result.totalTokens).toBe(10);
    expect(result.injectedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    expect(result.messages.map((m) => m.content)).toEqual(["A", "B"]);
  });

  it("removeInjection deletes an item", () => {
    injector.addInjection({
      id: "del",
      content: "Delete me",
      tokenCount: 1,
      priority: 1,
      enabled: true,
      point: "system",
    });

    expect(injector.removeInjection("del")).toBe(true);
    expect(injector.getAllInjections()).toHaveLength(0);
  });

  it("updateInjection modifies fields", () => {
    injector.addInjection({
      id: "up",
      content: "Original",
      tokenCount: 1,
      priority: 1,
      enabled: true,
      point: "system",
    });

    const ok = injector.updateInjection("up", { content: "Updated", priority: 99 });
    expect(ok).toBe(true);

    const item = injector.getAllInjections()[0];
    expect(item.content).toBe("Updated");
    expect(item.priority).toBe(99);
  });

  it("setEnabled toggles enabled state", () => {
    injector.addInjection({
      id: "toggle",
      content: "Toggle",
      tokenCount: 1,
      priority: 1,
      enabled: true,
      point: "system",
    });

    injector.setEnabled("toggle", false);
    const result = injector.inject({}, 100);
    expect(result.messages).toHaveLength(0);
  });

  it("clear removes all items and history", () => {
    injector.addInjection({
      id: "x",
      content: "X",
      tokenCount: 1,
      priority: 1,
      enabled: true,
      point: "system",
    });
    injector.inject({}, 100);

    injector.clear();
    expect(injector.getAllInjections()).toHaveLength(0);
    expect(injector.inject({}, 100).injectedCount).toBe(0);
  });

  it("clearHistory resets frequency tracking only", () => {
    const item: InjectionItem = {
      id: "freq",
      content: "Freq",
      tokenCount: 1,
      priority: 1,
      enabled: true,
      point: "system",
    };

    injector.addInjection(item);
    injector.inject({}, 100);
    injector.clearHistory();

    const result = injector.inject({}, 100);
    expect(result.injectedCount).toBe(1);
  });
});
