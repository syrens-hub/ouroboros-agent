import type { BaseMessage } from "../../types/index.ts";

export type InjectionPoint = "system" | "pre_user" | "pre_assistant" | "dynamic";

export interface InjectionItem {
  id: string;
  content: string;
  tokenCount: number;
  priority: number;
  enabled: boolean;
  point: InjectionPoint;
  condition?: (state: unknown) => boolean;
  maxFrequency?: number;
}

export interface InjectionResult {
  messages: BaseMessage[];
  totalTokens: number;
  injectedCount: number;
  skippedCount: number;
}

export class ContextInjector {
  private items: Map<string, InjectionItem> = new Map();
  private history: Map<string, number> = new Map();

  addInjection(item: InjectionItem): void {
    this.items.set(item.id, item);
  }

  removeInjection(id: string): boolean {
    return this.items.delete(id);
  }

  updateInjection(id: string, updates: Partial<Omit<InjectionItem, "id">>): boolean {
    const existing = this.items.get(id);
    if (!existing) return false;
    this.items.set(id, { ...existing, ...updates });
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    return this.updateInjection(id, { enabled });
  }

  getAllInjections(): InjectionItem[] {
    return Array.from(this.items.values());
  }

  clear(): void {
    this.items.clear();
    this.history.clear();
  }

  clearHistory(): void {
    this.history.clear();
  }

  syncInjections(injections: InjectionItem[]): void {
    const newIds = new Set(injections.map((i) => i.id));
    // Remove items that are no longer present
    for (const id of this.items.keys()) {
      if (!newIds.has(id)) {
        this.items.delete(id);
        this.history.delete(id);
      }
    }
    // Add or update new items
    for (const item of injections) {
      this.items.set(item.id, item);
    }
  }

  inject(state: unknown, maxTokens: number): InjectionResult {
    const candidates = Array.from(this.items.values()).filter((item) => {
      if (!item.enabled) return false;
      if (item.condition && !item.condition(state)) return false;
      return true;
    });

    candidates.sort((a, b) => b.priority - a.priority);

    const messages: BaseMessage[] = [];
    let totalTokens = 0;
    let injectedCount = 0;
    let skippedCount = 0;

    for (const item of candidates) {
      const currentCount = this.history.get(item.id) ?? 0;
      const maxFrequency = item.maxFrequency ?? 1;

      if (maxFrequency > 0 && currentCount >= maxFrequency) {
        skippedCount++;
        continue;
      }

      if (totalTokens + item.tokenCount > maxTokens) {
        skippedCount++;
        continue;
      }

      const message: BaseMessage =
        item.point === "system"
          ? { role: "system", content: item.content }
          : { role: "user", name: "context_injector", content: item.content };

      messages.push(message);
      totalTokens += item.tokenCount;
      injectedCount++;
      this.history.set(item.id, currentCount + 1);
    }

    return {
      messages,
      totalTokens,
      injectedCount,
      skippedCount,
    };
  }
}
