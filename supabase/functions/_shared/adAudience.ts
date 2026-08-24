// Translates StabiFlow's simple "audience basics" shape (instruction #3,
// Builder step 3) into a Meta Marketing API `targeting` spec object. Kept
// as a pure, isolated translator specifically so ad_campaigns.audience can
// stay a StabiFlow-friendly shape in the database and UI forever, even if
// Meta's targeting spec grows more fields later - "do not overfit schema to
// one current Meta API response shape" (schema migration header note).
export type AudienceBasics = {
  age_min?: number;
  age_max?: number;
  genders?: "all" | "male" | "female";
  geo_countries?: string[]; // ISO 3166-1 alpha-2, e.g. ["ZA"]
  interests?: Array<{ id: string; name: string }>;
};

const DEFAULT_AGE_MIN = 18;
const DEFAULT_AGE_MAX = 65;

export type AudienceValidation = { valid: true } | { valid: false; issues: string[] };

export function validateAudienceBasics(audience: AudienceBasics): AudienceValidation {
  const issues: string[] = [];
  const ageMin = audience.age_min ?? DEFAULT_AGE_MIN;
  const ageMax = audience.age_max ?? DEFAULT_AGE_MAX;
  if (ageMin < 13 || ageMin > 65) issues.push("age_min must be between 13 and 65");
  if (ageMax < 13 || ageMax > 65) issues.push("age_max must be between 13 and 65");
  if (ageMax < ageMin) issues.push("age_max must be greater than or equal to age_min");
  if (!audience.geo_countries || audience.geo_countries.length === 0) {
    issues.push("at least one target country is required");
  } else if (audience.geo_countries.some((c) => !/^[A-Z]{2}$/.test(c))) {
    issues.push("geo_countries must be ISO 3166-1 alpha-2 codes (e.g. \"ZA\")");
  }
  return issues.length ? { valid: false, issues } : { valid: true };
}

export function buildMetaTargetingSpec(audience: AudienceBasics): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    age_min: audience.age_min ?? DEFAULT_AGE_MIN,
    age_max: audience.age_max ?? DEFAULT_AGE_MAX,
    geo_locations: { countries: audience.geo_countries || [] },
  };
  if (audience.genders === "male") spec.genders = [1];
  else if (audience.genders === "female") spec.genders = [2];
  // omitted entirely (not [1,2]) for "all" - Meta treats an absent
  // `genders` field as "all genders", and an explicit [1,2] behaves
  // identically but is one more thing to keep in sync if that ever changes.

  if (audience.interests && audience.interests.length) {
    spec.flexible_spec = [{ interests: audience.interests.map((i) => ({ id: i.id, name: i.name })) }];
  }
  return spec;
}
