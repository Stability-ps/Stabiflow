// Phase 15 - bounded provider fetch.
//
// Every Meta Graph call in the WhatsApp integration path (discovery,
// number health, webhook subscribe/verify) previously used a bare
// `await fetch(...)` with no ceiling: a hung Meta connection blocked the
// whole edge function until its runtime wall-clock limit. This wraps
// fetch in an AbortController so a slow provider fails fast and
// deterministically.
//
// Deliberately NOT a retry/backoff layer - the operator's "Repair" button
// is the retry mechanism. This only bounds a single attempt's wait.
//
// The Graph URL carries `?access_token=<vault token>` in its query
// string, so the timeout error text is a fixed string and NEVER includes
// the URL - callers classify it via classifyIntegrationNetworkError()
// (network_error / temporary_unavailable), the existing taxonomy.

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

/** Thrown when the provider does not respond within the timeout. Message
 * is a fixed, secret-free sentence; `name` lets callers/tests recognise
 * it without string matching. */
export class ProviderTimeoutError extends Error {
  constructor() {
    super("The provider did not respond in time. Try again.");
    this.name = "ProviderTimeoutError";
  }
}

/**
 * fetch() with a hard timeout. On timeout the request is aborted and a
 * ProviderTimeoutError is thrown (route it through
 * classifyIntegrationNetworkError for the standard temporary/network
 * classification). Any caller-supplied `init.signal` is respected too -
 * aborting it also aborts the request. The timer is always cleared.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const ms = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_PROVIDER_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), ms);

  // Chain a caller-provided signal so cancelling it also cancels us.
  const external = init.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Our own timeout: report it as a clean, secret-free timeout.
    if (controller.signal.aborted && !(external?.aborted)) {
      throw new ProviderTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
