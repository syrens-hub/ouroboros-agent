/**
 * Ouroboros Notification Bus
 * ===========================
 * A lightweight global event emitter for cross-layer notifications.
 * Used to push background review results, daemon decisions, and system events
 * to the Web UI without tight coupling.
 */

import { EventEmitter } from "events";

export interface NotificationEvent {
  type: "skill_learned" | "daemon_decision" | "review_decision" | "system" | "audit" | "webhook";
  title: string;
  message: string;
  timestamp: number;
  meta?: Record<string, unknown>;
}

class NotificationBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }
  emitEvent(event: NotificationEvent): void {
    this.emit("notification", event);
  }
}

export const notificationBus = new NotificationBus();
