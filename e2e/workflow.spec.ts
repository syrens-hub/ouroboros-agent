import { test, expect } from "@playwright/test";

test.describe("Workflow Studio E2E", () => {
  test("can navigate to Workflow and run a SOP template", async ({ page }) => {
    await page.goto("/");
    await page.locator("button:has-text('工作流')").first().click();
    await expect(page.locator("text=CrewAI").first()).toBeVisible();

    // Switch to SOP tab
    await page.locator("button:has-text('SOP')").first().click();
    await expect(page.locator("select").first()).toBeVisible();

    // Wait for templates to load
    await expect(page.locator("select option[value='code_review']")).toHaveCount(1, { timeout: 5000 });

    // Select a template
    await page.locator("select").first().selectOption("code_review");
    await expect(page.locator("text=developer").first()).toBeVisible({ timeout: 5000 });

    // Run workflow
    await page.locator("button:has-text('Run')").first().click();
    await expect(page.locator("text=completed").first()).toBeVisible({ timeout: 15000 });
  });
});
