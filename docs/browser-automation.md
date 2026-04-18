# 浏览器自动化

## 概述

基于 Playwright 的浏览器自动化模块，支持 Chromium/Chrome/Firefox 控制。

## 安装

```bash
# 安装 Playwright 浏览器
npx playwright install chromium
```

## 工具清单

| 工具 | 描述 | 参数 |
|------|------|------|
| `browser_navigate` | 导航到URL | `url`, `sessionId?`, `timeoutMs?` |
| `browser_click` | 点击元素 | `selector`, `selectorType?`, `sessionId?` |
| `browser_type` | 输入文本 | `selector`, `text`, `selectorType?`, `sessionId?` |
| `browser_view` | 获取页面内容 | `sessionId?`, `selector?`, `selectorType?` |
| `browser_screenshot` | 页面截图 | `sessionId?`, `path?`, `fullPage?` |
| `browser_console` | 获取控制台日志 | `sessionId?`, `level?` |

## 使用示例

```typescript
import { browserNavigate, browserClick, browserScreenshot } from "./core/browser-automation";

// 导航到页面
await browserNavigate({ url: "https://example.com" });

// 点击按钮
await browserClick({ selector: "#submit-btn" });

// 截图
await browserScreenshot({ path: "./screenshot.png", fullPage: true });
```

## Session管理

每个浏览器会话独立，支持多并发：

```typescript
// 创建新会话
const session1 = await browserNavigate({ 
  url: "https://example.com",
  sessionId: "session-1"
});

// 同一会话继续操作
await browserClick({ 
  selector: "button",
  sessionId: "session-1"
});
```

## 元素定位

支持多种定位方式：

```typescript
// CSS 选择器 (默认)
await browserClick({ selector: ".class-name", selectorType: "css" });

// XPath
await browserClick({ selector: "//button[@id='submit']", selectorType: "xpath" });

// ARIA label
await browserClick({ selector: "Submit", selectorType: "aria" });
```

## 错误处理

所有函数返回 `Result` 类型，遵循 fail-closed 原则：

```typescript
const result = await browserNavigate({ url: "https://invalid-url" });
if (!result.success) {
  console.error("错误:", result.error);
}
```
