/**
 * 日志增强模块
 * 学习自 Claude Code 的 logEvent + logForDebugging 系统
 * 
 * 支持分类日志：
 * - startup: 启动相关事件
 * - error: 错误事件
 * - tool_use: 工具使用
 * - session: 会话事件
 * - api: API调用
 * - performance: 性能相关
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

export enum EventCategory {
  STARTUP = 'startup',
  ERROR = 'error',
  TOOL_USE = 'tool_use',
  SESSION = 'session',
  API = 'api',
  PERFORMANCE = 'performance'
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: EventCategory;
  event: string;
  duration?: number;
  metadata?: Record<string, unknown>;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private enabledCategories: Set<EventCategory> = new Set(Object.values(EventCategory));
  private minLevel: LogLevel = LogLevel.INFO;

  constructor() {
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      const configPath = `${process.env.HOME}/.openclaw/workspace/logs/config.json`;
      // 可以在此加载配置文件
    } catch (e) {
      // 使用默认配置
    }
  }

  log(
    level: LogLevel,
    category: EventCategory,
    event: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level, category)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      event,
      metadata
    };

    this.logs.push(entry);

    // 保持日志数量在限制内
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // 输出到控制台
    this.output(entry);
  }

  private shouldLog(level: LogLevel, category: EventCategory): boolean {
    if (!this.enabledCategories.has(category)) {
      return false;
    }
    return this.getLevelPriority(level) >= this.getLevelPriority(this.minLevel);
  }

  private getLevelPriority(level: LogLevel): number {
    const priorities = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3
    };
    return priorities[level];
  }

  private output(entry: LogEntry): void {
    const prefix = `[${entry.category.toUpperCase()}]`;
    const message = `${entry.timestamp} ${prefix} ${entry.event}`;
    
    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(message, entry.metadata || '');
        break;
      case LogLevel.WARN:
        console.warn(message, entry.metadata || '');
        break;
      default:
        console.log(message, entry.metadata || '');
    }
  }

  // 便捷方法
  startup(event: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, EventCategory.STARTUP, event, metadata);
  }

  error(event: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, EventCategory.ERROR, event, metadata);
  }

  toolUse(event: string, duration?: number, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, EventCategory.TOOL_USE, event, { ...metadata, duration });
  }

  session(event: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, EventCategory.SESSION, event, metadata);
  }

  api(event: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, EventCategory.API, event, metadata);
  }

  performance(event: string, duration: number, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, EventCategory.PERFORMANCE, event, { ...metadata, durationMs: duration });
  }

  // 查询日志
  query(options: {
    category?: EventCategory;
    level?: LogLevel;
    since?: Date;
    until?: Date;
    limit?: number;
  }): LogEntry[] {
    let results = [...this.logs];

    if (options.category) {
      results = results.filter(log => log.category === options.category);
    }
    if (options.level) {
      results = results.filter(log => log.level === options.level);
    }
    if (options.since) {
      results = results.filter(log => new Date(log.timestamp) >= options.since!);
    }
    if (options.until) {
      results = results.filter(log => new Date(log.timestamp) <= options.until!);
    }

    return results.slice(-(options.limit || 100));
  }

  // 获取统计
  getStats(): Record<EventCategory, number> {
    const stats: Record<string, number> = {} as Record<EventCategory, number>;
    for (const category of Object.values(EventCategory)) {
      stats[category] = this.logs.filter(log => log.category === category).length;
    }
    return stats;
  }

  // 导出日志
  export(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  // 清空日志
  clear(): void {
    this.logs = [];
  }
}

// 导出单例
export const logger = new Logger();

// 便捷函数
export const logStartup = (event: string, metadata?: Record<string, unknown>) => 
  logger.startup(event, metadata);

export const logError = (event: string, metadata?: Record<string, unknown>) => 
  logger.error(event, metadata);

export const logToolUse = (event: string, duration?: number, metadata?: Record<string, unknown>) => 
  logger.toolUse(event, duration, metadata);

export const logSession = (event: string, metadata?: Record<string, unknown>) => 
  logger.session(event, metadata);

export const logApi = (event: string, metadata?: Record<string, unknown>) => 
  logger.api(event, metadata);

export const logPerformance = (event: string, duration: number, metadata?: Record<string, unknown>) => 
  logger.performance(event, duration, metadata);
