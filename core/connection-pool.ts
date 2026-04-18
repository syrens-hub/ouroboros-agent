import { safeIgnore } from "./safe-utils.ts";

type PoolEvent = "acquire" | "release" | "create" | "close" | "error";

type PoolConfig = {
  minConnections?: number;
  maxConnections?: number;
  acquireTimeoutMs?: number;
  idleTimeoutMs?: number;
};

type IdleItem<T> = {
  conn: T;
  since: number;
};

type PendingRequest<T> = {
  resolve: (conn: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type ConnectionPoolStats = {
  activeConnections: number;
  idleConnections: number;
};

export class ConnectionPool<T> {
  private factory: () => Promise<T>;
  private closer: (conn: T) => Promise<void> | void;
  private validator?: (conn: T) => Promise<boolean> | boolean;
  private config: Required<PoolConfig>;
  private idle: Array<IdleItem<T>> = [];
  private active: Set<T> = new Set();
  private creating = 0;
  private pending: Array<PendingRequest<T>> = [];
  private listeners: Map<PoolEvent, Set<(payload?: unknown) => void>> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private drained = false;
  private _name?: string;

  constructor(
    factory: () => Promise<T>,
    closer: (conn: T) => Promise<void> | void,
    config: PoolConfig = {},
    validator?: (conn: T) => Promise<boolean> | boolean,
  ) {
    this.factory = factory;
    this.closer = closer;
    this.validator = validator;
    this.config = {
      minConnections: config.minConnections ?? 0,
      maxConnections: config.maxConnections ?? 10,
      acquireTimeoutMs: config.acquireTimeoutMs ?? 30000,
      idleTimeoutMs: config.idleTimeoutMs ?? 60000,
    };

    if (this.config.idleTimeoutMs > 0 && this.config.idleTimeoutMs !== Infinity) {
      const intervalMs = Math.min(
        1000,
        Math.max(100, Math.floor(this.config.idleTimeoutMs / 2)),
      );
      this.cleanupInterval = setInterval(() => this.cleanupIdle(), intervalMs);
    }
  }

  on(event: PoolEvent, listener: (payload: unknown) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  private emit(event: PoolEvent, payload?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      safeIgnore(() => listener(payload), "connection-pool listener");
    }
  }

  private get totalConnections(): number {
    return this.idle.length + this.active.size + this.creating;
  }

  async acquire(): Promise<T> {
    if (this.drained) {
      throw new Error("Pool is drained");
    }

    // Reuse an idle connection if possible
    while (this.idle.length > 0) {
      const item = this.idle.pop()!;
      if (this.validator) {
        try {
          const ok = await this.validator(item.conn);
          if (!ok) {
            this.safeClose(item.conn);
            continue;
          }
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
          this.safeClose(item.conn);
          continue;
        }
      }
      this.active.add(item.conn);
      this.emit("acquire", item.conn);
      return item.conn;
    }

    // Create a new connection if under the limit
    if (this.totalConnections < this.config.maxConnections) {
      this.creating += 1;
      try {
        const conn = await this.factory();
        this.active.add(conn);
        this.emit("create", conn);
        this.emit("acquire", conn);
        return conn;
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
        throw err;
      } finally {
        this.creating -= 1;
      }
    }

    // Queue the request
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.pending.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) {
          this.pending.splice(idx, 1);
        }
        reject(new Error("Acquire timeout"));
      }, this.config.acquireTimeoutMs);

      this.pending.push({ resolve, reject, timer });
    });
  }

  release(conn: T): void {
    if (this.drained) {
      this.safeClose(conn);
      return;
    }

    if (!this.active.has(conn)) {
      this.emit("error", new Error("Released connection is not active"));
      this.safeClose(conn);
      return;
    }

    this.active.delete(conn);
    this.emit("release", conn);

    // Hand off to the next waiter if any
    if (this.pending.length > 0) {
      const waiter = this.pending.shift()!;
      clearTimeout(waiter.timer);
      this.active.add(conn);
      this.emit("acquire", conn);
      waiter.resolve(conn);
      return;
    }

    // Return to the idle pool
    this.idle.push({ conn, since: Date.now() });
  }

  async drain(): Promise<void> {
    if (this.drained) return;
    this.drained = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Reject pending waiters
    while (this.pending.length > 0) {
      const waiter = this.pending.shift()!;
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Pool is drained"));
    }

    // Close all connections
    const toClose: T[] = [...this.idle.map((i) => i.conn), ...this.active];
    this.idle = [];
    this.active.clear();

    // safeClose already handles errors internally via emit("error")
    for (const conn of toClose) {
      this.safeClose(conn);
    }
  }

  private cleanupIdle(): void {
    if (this.drained) return;
    const now = Date.now();
    while (
      this.idle.length > this.config.minConnections &&
      now - this.idle[0]!.since > this.config.idleTimeoutMs
    ) {
      const item = this.idle.shift()!;
      this.safeClose(item.conn);
    }
  }

  getStats(): ConnectionPoolStats {
    return {
      activeConnections: this.active.size,
      idleConnections: this.idle.length,
    };
  }

  private safeClose(conn: T): void {
    Promise.resolve()
      .then(() => this.closer(conn))
      .then(() => this.emit("close", conn))
      .catch((err) => this.emit("error", err instanceof Error ? err : new Error(String(err))));
  }
}
