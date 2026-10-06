// Paystack API client + webhook signature verification.
//
// Secrets: PAYSTACK_SECRET_KEY is an edge-function secret, never in the
// repository or database. PAYSTACK_MOCK_MODE=true replaces every outbound
// call with a deterministic local response (tests / local dev) - no money
// moves and no network request is made.

const PAYSTACK_API = "https://api.paystack.co";

export type PaystackConfig = { secretKey: string | null; mockMode: boolean };

export function paystackConfigFromEnv(): PaystackConfig {
  const secretKey = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim() || null;
  // Mock mode can never coexist with a live key: in mock mode verify
  // "succeeds" any checkout, which must be impossible in production.
  const mockMode = (Deno.env.get("PAYSTACK_MOCK_MODE") ?? "").trim().toLowerCase() === "true" && !secretKey?.startsWith("sk_live_");
  return { secretKey, mockMode };
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

export async function sha256Hex(body: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Paystack signs the RAW request body with HMAC-SHA512 using the secret key (x-paystack-signature). */
export async function verifyPaystackSignature(secretKey: string, rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !secretKey) return false;
  const expected = await hmacSha512Hex(secretKey, rawBody);
  return timingSafeEqualHex(expected, signatureHeader.trim().toLowerCase());
}

type PaystackEnvelope<T> = { status: boolean; message: string; data: T };

async function call<T>(cfg: PaystackConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (!cfg.secretKey) throw new Error("Paystack is not configured");
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let parsed: PaystackEnvelope<T> | null = null;
  try {
    parsed = (await res.json()) as PaystackEnvelope<T>;
  } catch {
    parsed = null;
  }
  if (!res.ok || !parsed?.status) {
    // Never echo the provider's raw response to callers - it can include
    // customer data. The message alone is safe and useful.
    throw new Error(`Paystack ${path.split("?")[0]} failed: ${parsed?.message ?? res.status}`);
  }
  return parsed.data;
}

export async function createCustomer(cfg: PaystackConfig, email: string): Promise<{ customer_code: string }> {
  if (cfg.mockMode) return { customer_code: `CUS_mock${(await sha256Hex(email)).slice(0, 12)}` };
  return call(cfg, "POST", "/customer", { email });
}

export type InitializeInput = {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  planCode?: string | null;
  metadata: Record<string, unknown>;
};

export async function initializeTransaction(cfg: PaystackConfig, input: InitializeInput): Promise<{ authorization_url: string; access_code: string; reference: string }> {
  if (cfg.mockMode) {
    const url = new URL(input.callbackUrl);
    url.searchParams.set("mock_checkout", "1");
    return { authorization_url: url.toString(), access_code: `mock_${input.reference}`, reference: input.reference };
  }
  return call(cfg, "POST", "/transaction/initialize", {
    email: input.email,
    amount: input.amountMinor,
    currency: input.currency,
    reference: input.reference,
    callback_url: input.callbackUrl,
    // For recurring prices Paystack creates the subscription after the
    // first successful charge; the amount then comes from the plan.
    ...(input.planCode ? { plan: input.planCode } : {}),
    metadata: input.metadata,
  });
}

export type VerifiedTransaction = {
  status: string; // "success" | "failed" | "abandoned" | ...
  reference: string;
  amount: number;
  currency: string;
  paid_at: string | null;
  customer?: { customer_code?: string; email?: string };
  plan?: { plan_code?: string } | string | null;
};

/** In mock mode, `mockExpected` describes the charge the checkout asked for. */
/** Paystack answers "Transaction reference not found" for a checkout the
 * customer never opened. That is a definite "not paid", not a transient
 * failure - reconciliation treats it like an unpaid checkout. */
export function isUnknownReferenceError(err: unknown): boolean {
  return err instanceof Error && /transaction reference not found/i.test(err.message);
}

export async function verifyTransaction(
  cfg: PaystackConfig,
  reference: string,
  mockExpected?: { amountMinor: number; currency: string },
): Promise<VerifiedTransaction> {
  if (cfg.mockMode) {
    return {
      status: mockExpected ? "success" : "abandoned",
      reference,
      amount: mockExpected?.amountMinor ?? 0,
      currency: mockExpected?.currency ?? "ZAR",
      paid_at: new Date().toISOString(),
    };
  }
  return call(cfg, "GET", `/transaction/verify/${encodeURIComponent(reference)}`);
}

export async function disableSubscription(cfg: PaystackConfig, code: string, emailToken: string): Promise<void> {
  if (cfg.mockMode) return;
  await call(cfg, "POST", "/subscription/disable", { code, token: emailToken });
}
