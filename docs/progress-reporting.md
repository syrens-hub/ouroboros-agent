# 进度报告系统

## 概述

统一的进度报告模块，支持 TTY 和非 TTY 双模式输出。

## 安装

无需安装，已集成在 `core/progress-reporter.ts`。

## 基础用法

```typescript
import { createProgressReporter } from "./core/progress-reporter";

const reporter = createProgressReporter({
  label: "下载文件",
  totalSteps: 100
});

// 更新进度
reporter.setProgress(25, "正在下载...");

// 完成
reporter.complete("下载完成!");
```

## 输出示例

### TTY 模式 (终端)

```
下载文件 ████████████░░░░░░░░░░░░░ 25% ETA: 00:30
```

### 非 TTY 模式 (日志)

```
[2024-04-17 17:00:00] [下载文件] 进度: 25/100 - 正在下载...
```

## API

### createProgressReporter

```typescript
function createProgressReporter(options: {
  label: string;
  totalSteps: number;
  showPercent?: boolean;
  showEta?: boolean;
}): ProgressReporter
```

### ProgressReporter 方法

| 方法 | 描述 |
|------|------|
| `setProgress(step, message?)` | 设置当前进度 |
| `complete(message?)` | 标记完成 |
| `error(message)` | 报告错误 (红色) |
| `warning(message)` | 报告警告 (黄色) |
| `checkpoint(id)` | 记录检查点 |
| `createSubProgress(label, totalSteps)` | 创建子进度 |

## 多进度管理

```typescript
import { createMultiProgressReporter } from "./core/progress-reporter";

const multi = createMultiProgressReporter();

const job1 = multi.createReporter("任务1", 100);
const job2 = multi.createReporter("任务2", 50);

job1.setProgress(50);
job2.setProgress(25);
```

## 与 Agent Loop 集成

```typescript
import { createProgressReporter } from "./core/progress-reporter";

const reporter = createProgressReporter({
  label: "Agent Loop",
  totalSteps: loopConfig.maxIterations,
  showEta: true
});

// 在每次迭代时更新
for await (const msg of runner.run(input)) {
  reporter.setProgress(currentIteration, `处理: ${input}`);
}
```
