import { test, expect } from "@playwright/test";

test.describe("Knowledge Base E2E", () => {
  test("can navigate to KB page, ingest text, and query", async ({ page }) => {
    await page.goto("/");
    await page.locator("button:has-text('知识库')").first().click();
    await expect(page.locator("text=安装 Skill").first()).not.toBeVisible();
    await expect(page.locator("text=知识库").first()).toBeVisible();

    // Switch to paste text tab
    await page.locator("button:has-text('粘贴文本')").first().click();
    const textarea = page.locator("textarea").first();
    await textarea.fill("Ouroboros is a self-modifying agent system.");
    await page.locator("button:has-text('Ingest')").first().click();

    // Wait for document list to update (ingest returns 200)
    await expect(page.locator("text=inline.txt").first()).toBeVisible({ timeout: 10000 });

    // Query
    const queryInput = page.locator("input[placeholder*='输入查询']").first();
    await queryInput.fill("self-modifying");
    await page.locator("button:has-text('Query')").first().click();
    await expect(page.locator("text=score:").first()).toBeVisible({ timeout: 10000 });
  });
});
