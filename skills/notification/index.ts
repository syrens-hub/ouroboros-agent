/**
 * Ouroboros Notification Bus (Adapter)
 * ====================================
 * Thin adapter over ProductionEventBus for backward-compatible notification APIs.
 * All notifications now flow through the unified eventBus, gaining retry,
 * dead-letter persistence, and queue management.
 *
 * Usage:
 *   notificationBus.emitEvent({ type: "system", title, message, timestamp })
 *   notificationBus.on("notification", handler)
 *   notificationBus.off("notification", handler)
 */

import { eventBus } from "../../core/event-bus.ts";
import type { HookContext, HookEventType } from "../../core/hook-system.ts";

export interface NotificationEvent {
  type: "skill_learned" | "daemon_decision" | "review_decision" | "system" | "audit" | "webhook";
  title: string;
  message: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

type NotificationHandler = (evt: NotificationEvent) => void;

class NotificationBus {
  private wrappers = new Map<NotificationHandler, (eventType: HookEventType, context: HookContext) => void>();

  on(_event: "notification", handler: NotificationHandler): void {
    const wrapper = (_eventType: HookEventType, context: HookContext) => {
      handler(context as unknown as NotificationEvent);
    };
    this.wrappers.set(handler, wrapper);
    eventBus.register("notification", wrapper);
  }

  off(_event: "notification", handler: NotificationHandler): void {
    const wrapper = this.wrappers.get(handler);
    if (wrapper) {
      eventBus.unregister("notification", wrapper);
      this.wrappers.delete(handler);
    }
  }

  emitEvent(event: NotificationEvent): void {
    eventBus.emitAsync("notification", event as unknown as HookContext);
  }
}

export const notificationBus = new NotificationBus();
