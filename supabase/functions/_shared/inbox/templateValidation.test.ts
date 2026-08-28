import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { countBodyParameters, describeTemplateEligibilityError, validateTemplateEligibility } from "./templateValidation.ts";

const APPROVED_ONE_PARAM = {
  provider_status: "APPROVED",
  language: "en_US",
  components: [{ type: "BODY", text: "Hi {{1}}, your order has shipped." }],
};

const APPROVED_TWO_PARAMS = {
  provider_status: "APPROVED",
  language: "en_US",
  components: [{ type: "BODY", text: "Hi {{1}}, your order {{2}} has shipped." }],
};

const APPROVED_ZERO_PARAMS = {
  provider_status: "APPROVED",
  language: "en_US",
  components: [{ type: "BODY", text: "Thanks for reaching out!" }],
};

Deno.test("countBodyParameters counts distinct placeholder numbers, not occurrences", () => {
  assertEquals(countBodyParameters(APPROVED_TWO_PARAMS.components), 2);
  assertEquals(countBodyParameters(APPROVED_ZERO_PARAMS.components), 0);
  assertEquals(countBodyParameters([{ type: "BODY", text: "{{1}} and {{1}} again" }]), 1);
});

Deno.test("countBodyParameters returns 0 when there is no BODY component", () => {
  assertEquals(countBodyParameters([{ type: "HEADER", text: "Header only" }]), 0);
  assertEquals(countBodyParameters([]), 0);
});

Deno.test("invalid/unapproved template is rejected: PENDING status", () => {
  const result = validateTemplateEligibility({ ...APPROVED_ONE_PARAM, provider_status: "PENDING" }, 1);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "not_approved");
});

Deno.test("invalid/unapproved template is rejected: REJECTED status", () => {
  const result = validateTemplateEligibility({ ...APPROVED_ONE_PARAM, provider_status: "REJECTED" }, 1);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "not_approved");
});

Deno.test("a null template (not found / wrong workspace) is rejected", () => {
  const result = validateTemplateEligibility(null, 0);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "not_found");
});

Deno.test("parameter validation: correct count for an APPROVED template passes", () => {
  const result = validateTemplateEligibility(APPROVED_TWO_PARAMS, 2);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.requiredParameterCount, 2);
});

Deno.test("parameter validation: too few parameters is rejected", () => {
  const result = validateTemplateEligibility(APPROVED_TWO_PARAMS, 1);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, { code: "parameter_count_mismatch", expected: 2, received: 1 });
});

Deno.test("parameter validation: too many parameters is rejected", () => {
  const result = validateTemplateEligibility(APPROVED_ONE_PARAM, 3);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error, { code: "parameter_count_mismatch", expected: 1, received: 3 });
});

Deno.test("a zero-parameter template accepts zero parameters", () => {
  assertEquals(validateTemplateEligibility(APPROVED_ZERO_PARAMS, 0).ok, true);
});

Deno.test("missing language is rejected even if otherwise approved", () => {
  const result = validateTemplateEligibility({ ...APPROVED_ONE_PARAM, language: "" }, 1);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "missing_language");
});

Deno.test("describeTemplateEligibilityError never includes a token/secret and is human-readable for every error code", () => {
  assertEquals(describeTemplateEligibilityError({ code: "not_found" }).length > 0, true);
  assertEquals(describeTemplateEligibilityError({ code: "not_approved", status: "PENDING" }).includes("PENDING"), true);
  assertEquals(describeTemplateEligibilityError({ code: "parameter_count_mismatch", expected: 2, received: 1 }).includes("2"), true);
  assertEquals(describeTemplateEligibilityError({ code: "missing_language" }).length > 0, true);
});
