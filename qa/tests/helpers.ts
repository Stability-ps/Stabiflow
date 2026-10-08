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

// A plan-gated module either renders, or shows StabiFlow's friendly lock -
// both are correct for a given workspace. The QA account can be on any plan.
const LOCKED = "(is|are) part of the (Business and Growth plans|Growth plan)|Not available on your workspace yet|Unlock Automations";
const orLocked = (re: RegExp) => new RegExp(`${re.source}|${LOCKED}`, "i");

export const authenticatedRoutes = [
  ["/app", /Workspace overview|Dashboard|Welcome to StabiFlow/i],
  ["/app/business-hub", /Business workspace|Business/i],
  ["/app/business-studio", /Business Studio/i],
  ["/app/guide", /What is StabiFlow\?/i],
  ["/app/documents", /Documents/i],
  ["/app/creative-studio", orLocked(/Creative Studio/)],
  ["/app/content/media-library", orLocked(/Content/)],
  ["/app/campaigns", orLocked(/Campaigns/)],
  ["/app/whatsapp/inbox", orLocked(/Messages/)],
  ["/app/leads", orLocked(/Leads/)],
  ["/app/customers", orLocked(/Customers/)],
  ["/app/automations", orLocked(/Automations/)],
  ["/app/analytics", orLocked(/Analytics/)],
  ["/app/flow-ai", orLocked(/Flow AI/)],
  ["/app/integrations", orLocked(/Integrations/)],
  ["/app/billing", /Billing & plans/i],
  ["/app/settings", /Settings/i],
] as const;
