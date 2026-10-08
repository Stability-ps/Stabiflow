import { test, expect } from "@playwright/test";
import { expectNoHorizontalOverflow, watchPageErrors } from "./helpers";

test.describe("public production smoke", () => {
  test("homepage, pricing and login are healthy", async ({ page }) => {
    const errors = watchPageErrors(page);

    for (const route of ["/", "/pricing", "/login"]) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), `${route} should return a successful response`).toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    expect(errors, "public pages should not emit JavaScript errors").toEqual([]);
  });

  test("app routes protect unauthenticated visitors", async ({ page }) => {
    await page.goto("/app/billing");
    await page.waitForURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });
});
