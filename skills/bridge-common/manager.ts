/**
 * Bridge Manager
 * ==============
 * Unified registry for all external tool bridges.
 * Discovers enabled bridges and routes operations.
 */

import { gitBridge } from "../bridge-git/index.ts";
import { obsidianBridge } from "../bridge-obsidian/index.ts";
import { notionBridge } from "../bridge-notion/index.ts";
import type { BridgeAdapter, BridgeItem, BridgeSearchResult } from "./types.ts";

const bridges: BridgeAdapter[] = [gitBridge, obsidianBridge, notionBridge];

export function getEnabledBridges(): BridgeAdapter[] {
  return bridges.filter((b) => b.enabled);
}

export function getBridge(name: string): BridgeAdapter | undefined {
  return bridges.find((b) => b.name === name && b.enabled);
}

export async function searchAllBridges(query: string, limit = 20): Promise<BridgeSearchResult> {
  const enabled = getEnabledBridges();
  const allItems: BridgeItem[] = [];

  for (const bridge of enabled) {
    try {
      const result = await bridge.search(query, Math.ceil(limit / enabled.length));
      allItems.push(...result.items);
    } catch {
      // skip failing bridges
    }
  }

  return { items: allItems.slice(0, limit), total: allItems.length };
}

export async function listAllBridges(limitPerBridge = 20): Promise<Record<string, BridgeItem[]>> {
  const enabled = getEnabledBridges();
  const result: Record<string, BridgeItem[]> = {};

  for (const bridge of enabled) {
    try {
      result[bridge.name] = await bridge.list(limitPerBridge);
    } catch {
      result[bridge.name] = [];
    }
  }

  return result;
}
