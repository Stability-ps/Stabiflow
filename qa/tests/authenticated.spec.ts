import { test, expect } from "@playwright/test";
import { authenticatedRoutes, expectNoHorizontalOverflow, signIn, watchPageErrors } from "./helpers";

const hasCredentials = !!process.env.STABIFLOW_QA_EMAIL && !!process.env.STABIFLOW_QA_PASSWORD;

test.describe("authenticated production smoke", () => {
  test.skip(!hasCredentials, "Set STABIFLOW_QA_EMAIL and STABIFLOW_QA_PASSWORD to run authenticated production checks.");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("core workspace routes load cleanly", async ({ page }) => {
    const errors = watchPageErrors(page);

    for (const [route, expected] of authenticatedRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toContainText(expected, { timeout: 15_000 });
      await expectNoHorizontalOverflow(page);
    }

    expect(errors, "core routes should not emit JavaScript errors").toEqual([]);
  });

  test("desktop sidebar remains stationary while dashboard scrolls", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop sidebar test");
    await page.goto("/app");

    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar).toBeVisible();
    const before = await sidebar.boundingBox();
    expect(before).not.toBeNull();

    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(250);

    const after = await sidebar.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
  });

  test("billing hierarchy is clear", async ({ page }) => {
    await page.goto("/app/billing");
    await expect(page.getByRole("heading", { name: "Billing & plans" })).toBeVisible();

    const previous = page.getByRole("button", { name: /Previous purchases/i });
    if (await previous.count()) {
      await expect(previous).toHaveAttribute("aria-expanded", "false");
      await previous.click();
      await expect(previous).toHaveAttribute("aria-expanded", "true");
    }
  });

  test("mobile app shell has no horizontal overflow", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Mobile layout test");
    for (const route of ["/app", "/app/leads", "/app/billing", "/app/settings"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expectNoHorizontalOverflow(page);
    }
  });
});
