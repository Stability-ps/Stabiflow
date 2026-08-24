import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildMetaTargetingSpec, validateAudienceBasics } from "./adAudience.ts";

Deno.test("valid audience with defaults passes", () => {
  const result = validateAudienceBasics({ geo_countries: ["ZA"] });
  assertEquals(result.valid, true);
});

Deno.test("missing geo_countries is invalid - a targetless ad is never allowed to be 'ready'", () => {
  const result = validateAudienceBasics({});
  assertEquals(result.valid, false);
});

Deno.test("age_max below age_min is invalid", () => {
  const result = validateAudienceBasics({ age_min: 40, age_max: 25, geo_countries: ["ZA"] });
  assertEquals(result.valid, false);
});

Deno.test("age outside 13-65 is invalid", () => {
  assertEquals(validateAudienceBasics({ age_min: 5, geo_countries: ["ZA"] }).valid, false);
  assertEquals(validateAudienceBasics({ age_max: 99, geo_countries: ["ZA"] }).valid, false);
});

Deno.test("non-ISO country codes are rejected", () => {
  const result = validateAudienceBasics({ geo_countries: ["South Africa"] });
  assertEquals(result.valid, false);
});

Deno.test("buildMetaTargetingSpec applies default age range when unset", () => {
  const spec = buildMetaTargetingSpec({ geo_countries: ["ZA"] });
  assertEquals(spec.age_min, 18);
  assertEquals(spec.age_max, 65);
});

Deno.test("buildMetaTargetingSpec maps genders to Meta's numeric codes", () => {
  assertEquals(buildMetaTargetingSpec({ genders: "male", geo_countries: ["ZA"] }).genders, [1]);
  assertEquals(buildMetaTargetingSpec({ genders: "female", geo_countries: ["ZA"] }).genders, [2]);
});

Deno.test("buildMetaTargetingSpec omits `genders` entirely for 'all' (Meta's implicit default)", () => {
  const spec = buildMetaTargetingSpec({ genders: "all", geo_countries: ["ZA"] });
  assertEquals("genders" in spec, false);
});

Deno.test("buildMetaTargetingSpec nests geo_countries under geo_locations.countries", () => {
  const spec = buildMetaTargetingSpec({ geo_countries: ["ZA", "NA"] });
  assertEquals(spec.geo_locations, { countries: ["ZA", "NA"] });
});

Deno.test("buildMetaTargetingSpec wraps interests in flexible_spec only when present", () => {
  const withInterests = buildMetaTargetingSpec({ geo_countries: ["ZA"], interests: [{ id: "123", name: "Fitness" }] });
  assertEquals(withInterests.flexible_spec, [{ interests: [{ id: "123", name: "Fitness" }] }]);

  const withoutInterests = buildMetaTargetingSpec({ geo_countries: ["ZA"] });
  assertEquals("flexible_spec" in withoutInterests, false);
});
