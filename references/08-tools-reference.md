# Browser Automation Tools Reference

Reference schema for Ouroboros browser automation tools. These tools use Playwright (chromium) to perform browser automation tasks.

**Import path:** `import { browserTools } from "./core/browser-tools.ts";`

**Registration:**
```ts
import { globalPool } from "./main.ts";
import { browserTools } from "./core/browser-tools.ts";
browserTools.forEach(t => globalPool.register(t));
```

---

## Tool: `browser_navigate`

Navigate to a URL in the browser.

**Input schema:**
```json
{
  "url": "https://example.com",
  "sessionId": "optional-session-id",
  "timeoutMs": 30000
}
```

**Output:**
```json
{
  "success": true,
  "title": "Page Title",
  "url": "https://example.com"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string (URL) | ✅ | Target URL to navigate to |
| `sessionId` | string | ✗ | Browser session ID (default: "default") |
| `timeoutMs` | number | ✗ | Navigation timeout in ms (default: 30000, max: 120000) |

---

## Tool: `browser_click`

Click an element on the page.

**Input schema:**
```json
{
  "selector": "#submit-button",
  "selectorType": "css",
  "sessionId": "optional-session-id",
  "timeoutMs": 30000,
  "button": "left"
}
```

**Output:**
```json
{
  "success": true,
  "elementDescription": "<button> \"Submit\""
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | ✅ | CSS selector, XPath (prefix `xpath=`), or ARIA label |
| `selectorType` | "css" \| "xpath" \| "aria" | ✗ | How to interpret the selector (default: "css") |
| `sessionId` | string | ✗ | Browser session ID |
| `timeoutMs` | number | ✗ | Timeout in ms (default: 30000) |
| `button` | "left" \| "right" \| "middle" | ✗ | Mouse button to use (default: "left") |

---

## Tool: `browser_type`

Type text into an input element.

**Input schema:**
```json
{
  "selector": "input[name='search']",
  "selectorType": "css",
  "text": "search query",
  "sessionId": "optional-session-id",
  "timeoutMs": 30000,
  "delayMs": 50,
  "pressEnter": true
}
```

**Output:**
```json
{
  "success": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `selector` | string | ✅ | CSS selector, XPath, or ARIA label |
| `selectorType` | "css" \| "xpath" \| "aria" | ✗ | Selector interpretation (default: "css") |
| `text` | string | ✅ | Text to type |
| `sessionId` | string | ✗ | Browser session ID |
| `timeoutMs` | number | ✗ | Timeout in ms (default: 30000) |
| `delayMs` | number | ✗ | Delay between keystrokes in ms (for pages needing type events) |
| `pressEnter` | boolean | ✗ | Press Enter after typing (default: false) |

---

## Tool: `browser_view`

Get visible text content of the page or a specific element.

**Input schema:**
```json
{
  "sessionId": "optional-session-id",
  "selector": "article.content",
  "selectorType": "css",
  "maxChars": 5000
}
```

**Output:**
```json
{
  "success": true,
  "content": "Page body text content...",
  "elements": [
    {
      "tag": "article",
      "text": "element text...",
      "attributes": { "class": "content", "id": "main" }
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | ✗ | Browser session ID |
| `selector` | string | ✗ | Element selector (omit for full page content) |
| `selectorType` | "css" \| "xpath" \| "aria" | ✗ | Selector interpretation (default: "css") |
| `maxChars` | number | ✗ | Max characters to return (default: 5000, max: 50000) |

---

## Tool: `browser_screenshot`

Take a screenshot of the page or a specific element.

**Input schema:**
```json
{
  "sessionId": "optional-session-id",
  "selector": null,
  "selectorType": "css",
  "fullPage": false,
  "path": "/tmp/screenshot.png",
  "baselinePath": "/tmp/baseline.png",
  "timeoutMs": 30000
}
```

**Output:**
```json
{
  "success": true,
  "base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAA...",
  "savedPath": "/tmp/screenshot.png",
  "diff": {
    "matched": true,
    "similarity": 1.0,
    "baselinePath": "/tmp/baseline.png"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | ✗ | Browser session ID |
| `selector` | string | ✗ | Element selector (omit for full page) |
| `selectorType` | "css" \| "xpath" \| "aria" | ✗ | Selector interpretation (default: "css") |
| `fullPage` | boolean | ✗ | Capture full scrollable page (default: false) |
| `path` | string | ✗ | File path to save the screenshot |
| `baselinePath` | string | ✗ | Baseline screenshot path for diff comparison |
| `timeoutMs` | number | ✗ | Timeout in ms (default: 30000) |

---

## Tool: `browser_console`

Retrieve browser console messages from the current page session.

**Input schema:**
```json
{
  "sessionId": "optional-session-id",
  "maxMessages": 100
}
```

**Output:**
```json
{
  "success": true,
  "messages": [
    { "type": "log", "text": "Application initialized" },
    { "type": "error", "text": "Failed to load resource: 404", "location": "https://example.com/app.js:42" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | string | ✗ | Browser session ID |
| `maxMessages` | number | ✗ | Max messages to return (default: 100, max: 1000) |

---

## Tool: `browser_close`

Close an active browser session and free resources.

**Input schema:**
```json
{
  "sessionId": "optional-session-id"
}
```

**Output:**
```json
{
  "success": true,
  "closed": true
}
```

---

## Architecture

### Browser Process Management
- **Pool-based lifecycle:** Each `sessionId` maps to an independent `BrowserInstance` (browser + page)
- **TTL:** Instances expire after 10 minutes to prevent zombie browsers
- **Auto-cleanup:** Stale browsers are closed on each new browser acquisition
- **Lazy launch:** Browser is only started when first tool is called

### Element Location
- **CSS selector:** Standard CSS selector (default)
- **XPath:** Prefix with `xpath=` (e.g., `xpath=//button[text()='Submit']`)
- **ARIA:** ARIA label or `aria-labelledby` attribute matching

### Screenshot Diff
- **Baseline comparison:** SHA-256 hash comparison against a stored baseline
- **Auto-baseline:** If baseline doesn't exist, the first screenshot becomes the baseline
- **Result:** `similarity: 1` means identical, `similarity: 0` means different

### Error Handling
- All tools return `{ success: false, error: "..." }` on failure (fail-closed pattern)
- Timeout errors are captured and returned as part of the result
- Browser crashes are detected and the pool entry is cleaned up

### Session Isolation
- Multiple concurrent sessions are supported via unique `sessionId` values
- Default session ("default") is shared when no `sessionId` is provided
- Each session maintains its own browser context and page state
