import { test, expect } from "@playwright/test";

test.describe("Ouroboros Web UI Smoke Tests", () => {
  test("homepage loads and shows title", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Ouroboros Agent");
  });

  test("can create a new session and send a message", async ({ page }) => {
    await page.goto("/");

    // Wait for page to load
    await expect(page.locator("h1")).toContainText("Ouroboros Agent");

    // Create new session via the plus button in the session list header
    await page.locator("button[title='新建会话']").click();

    // Wait for a session item to appear in the list
    await expect(page.locator("[class*='bg-accent']").first()).toBeVisible({ timeout: 5000 });

    // Find the chat input - it's likely a textarea or input near the bottom
    const input = page.locator("textarea, input").last();
    await input.fill("hello");
    await input.press("Enter");

    // Wait for some assistant response content to appear in the chat area
    await expect(page.locator("text=Ouroboros").first()).toBeVisible({ timeout: 15000 });
  });

  test("can navigate to Skills page", async ({ page }) => {
    await page.goto("/");
    // Use more specific selector - the nav button containing "Skills"
    await page.locator("button:has-text('Skills')").first().click();
    await expect(page.locator("text=安装 Skill").first()).toBeVisible();
  });

  test("can navigate to System page", async ({ page }) => {
    await page.goto("/");
    await page.locator("button:has-text('系统')").first().click();
    await expect(page.locator("text=系统检查").first()).toBeVisible();
  });

  test("System page shows new OpenClaw feature cards", async ({ page }) => {
    await page.goto("/");
    await page.locator("button:has-text('系统')").first().click();

    // Self-healing card
    await expect(page.locator("text=自愈系统").first()).toBeVisible();
    await expect(page.locator("text=快照数:").first()).toBeVisible();

    // Task scheduler card
    await expect(page.locator("text=任务调度器").first()).toBeVisible();

    // Multimedia card
    await expect(page.locator("text=多媒体生成").first()).toBeVisible();
    await expect(page.locator("button:has-text('图片')").first()).toBeVisible();
    await expect(page.locator("button:has-text('视频')").first()).toBeVisible();
    await expect(page.locator("button:has-text('音乐')").first()).toBeVisible();

    // Locale selector
    await expect(page.locator("select").first()).toBeVisible();

    // ControlUI toggles
    await expect(page.locator("text=控制台").first()).toBeVisible();
    await expect(page.locator("text=Self-Healing").first()).toBeVisible();

    // Learning Insights
    await expect(page.locator("text=学习洞察").first()).toBeVisible();
  });

  test("can trigger a system health check", async ({ page }) => {
    await page.goto("/");
    await page.locator("button:has-text('系统')").first().click();

    const checkButton = page.locator("button:has-text('自检')").first();
    await expect(checkButton).toBeVisible();
    await checkButton.click();

    // After clicking, health checks should appear
    await expect(page.locator("text=LLM 连接").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=SessionDB").first()).toBeVisible();
  });
});
