// Pure evaluation of an automation's conditions against a domain event's
// payload - ANDed, never OR in V1 (per the approved scope). Kept pure and
// side-effect-free so it can be unit tested without a database, and so its
// per-condition result can be stored verbatim in automation_runs.conditions_result
// for observability (durable rule from the Phase J investigation report).
export type ConditionDefinition = {
  field: string;
  operator: string;
  value: unknown;
};

export type ConditionEvalResult = {
  field: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
};

function getByPath(payload: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, payload);
}

function evalOne(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual);
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "is_null":
      return actual === null || actual === undefined;
    case "is_not_null":
      return actual !== null && actual !== undefined;
    default:
      // An operator outside CONDITION_OPERATORS should never reach here
      // (schema CHECK constraint + isConditionOperator guard both refuse
      // it earlier) - failing closed rather than throwing keeps a
      // malformed condition from ever accidentally evaluating to "match".
      return false;
  }
}

export function evaluateConditions(conditions: ConditionDefinition[], payload: Record<string, unknown>): { allPassed: boolean; results: ConditionEvalResult[] } {
  const results = conditions.map((condition) => {
    const actual = getByPath(payload, condition.field);
    const passed = evalOne(actual, condition.operator, condition.value);
    return { field: condition.field, operator: condition.operator, expected: condition.value, actual, passed };
  });
  return { allPassed: results.every((r) => r.passed), results };
}
