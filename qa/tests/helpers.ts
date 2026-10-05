import { expect, type Page } from "@playwright/test";

export function watchPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page should not have unexpected horizontal overflow").toBeLessThanOrEqual(2);
}

export async function signIn(page: Page) {
  const email = process.env.STABIFLOW_QA_EMAIL;
  const password = process.env.STABIFLOW_QA_PASSWORD;
  if (!email || !password) throw new Error("QA credentials are not configured");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app(?:\/|$)/, { timeout: 20_000 });
}

export const authenticatedRoutes = [
  ["/app", /Workspace overview|Dashboard/i],
  ["/app/business-hub", /Business workspace|Business/i],
  ["/app/business-studio", /Business Studio/i],
  ["/app/documents", /Documents/i],
  ["/app/creative-studio", /Creative Studio/i],
  ["/app/content/media-library", /Content/i],
  ["/app/campaigns", /Campaigns/i],
  ["/app/whatsapp/inbox", /Messages/i],
  ["/app/leads", /Leads/i],
  ["/app/customers", /Customers/i],
  ["/app/automations", /Automations|Unlock Automations/i],
  ["/app/analytics", /Analytics/i],
  ["/app/flow-ai", /Flow AI/i],
  ["/app/integrations", /Integrations/i],
  ["/app/billing", /Billing & plans/i],
  ["/app/settings", /Settings/i],
] as const;
