// The actual reference is minted server-side by next_lead_reference() (a
// Postgres function, race-free via a row-locked UPDATE ... RETURNING -
// see the schema migration) - not reproducible as client-side pure logic,
// since it depends on per-workspace database state. This is the client's
// format contract with that function: any string handed back from the
// backend as a lead's human_reference must match this shape, and it's the
// one part of the reference scheme worth pinning down with a unit test.
const LEAD_REFERENCE_PATTERN = /^LEAD-\d{6}$/;

export function isValidLeadReference(value: string): boolean {
  return LEAD_REFERENCE_PATTERN.test(value);
}
