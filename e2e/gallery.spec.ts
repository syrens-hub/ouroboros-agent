import { test, expect } from "@playwright/test";

test.describe("Gallery E2E", () => {
  test("can navigate to Gallery and draw on canvas", async ({ page }) => {
    await page.goto("/");
    await page.locator("button:has-text('图库')").first().click();
    await expect(page.locator("text=截图").first()).toBeVisible();

    // Switch to canvas tab
    await page.locator("button:has-text('画布')").first().click();
    await expect(page.locator("input[type='color']").first()).toBeVisible();

    // Click rectangle preset
    await page.locator("button:has-text('矩形')").first().click();

    // Wait for canvas draw result image
    await expect(page.locator("img[src^='data:image/png']").first()).toBeVisible({ timeout: 15000 });
  });
});
