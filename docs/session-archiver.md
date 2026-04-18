# Session 归档系统

## 概述

自动将旧 Session 数据归档到压缩存储，支持热/温/冷三级存储。

## 分级策略

| 分级 | 保留时间 | 存储格式 | 处理 |
|------|---------|---------|------|
| Hot | 0-30天 | 原文件 | 正常访问 |
| Warm | 31-90天 | `.gz.json` | 压缩存储 |
| Cold | 91-180天 | `.tar.gz` | 压缩+清理原文件 |

## 使用方法

### 手动触发归档

```typescript
import { createSessionArchiver } from "./core/session-archiver";

const archiver = createSessionArchiver({
  hotTtlDays: 30,
  warmTtlDays: 90,
  coldTtlDays: 180,
  archivePath: "./.ouroboros/archives"
});

await archiver.run();
```

### 查看归档统计

```typescript
const stats = archiver.getStats();
console.log(`总Session数: ${stats.totalSessions}`);
console.log(`热数据: ${stats.hotSessions}`);
console.log(`温数据: ${stats.warmSessions}`);
console.log(`冷数据: ${stats.coldSessions}`);
```

### 查询归档内容

```typescript
// 查询所有温数据
const warmSessions = archiver.querySessions("warm");

// 查询所有归档
const allArchived = archiver.querySessions();
```

## Cron 定时归档

建议添加 Cron 任务每日执行：

```bash
# crontab -e
0 3 * * * cd /path/to/ouroboros && npx tsx scripts/cleanup-sessions.ts
```

### 清理脚本

```typescript
// scripts/cleanup-sessions.ts
import { createSessionArchiver } from "../core/session-archiver";

async function main() {
  const archiver = createSessionArchiver();
  
  console.log("开始归档检查...");
  await archiver.run();
  
  const stats = archiver.getStats();
  console.log(`归档完成: ${stats.archivedCount} 个文件归档`);
}

main().catch(console.error);
```

## 与 main.ts 集成

在 `main.ts` 的 shutdown 函数中自动触发：

```typescript
async function shutdown(signal: string) {
  console.log(`\n收到 ${signal}，正在关闭...`);
  
  // 创建归档
  const archiver = createSessionArchiver();
  await archiver.run();
  
  process.exit(0);
}
```

## 配置选项

```typescript
interface ArchiverConfig {
  hotTtlDays: number;      // 热数据保留天数
  warmTtlDays: number;     // 温数据保留天数
  coldTtlDays: number;     // 冷数据保留天数
  archivePath: string;     // 归档存储路径
  maxArchiveSize?: number; // 最大归档大小 (MB)
  compressionLevel?: number; // 压缩级别 1-9
}
```
