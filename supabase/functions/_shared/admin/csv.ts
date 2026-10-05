// RFC 4180 CSV with spreadsheet formula-injection protection. Pure module.

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "object" ? JSON.stringify(value) : String(value);
  // A leading =, +, -, @ makes Excel/Sheets evaluate the cell. Numbers are
  // safe and stay numeric.
  if (typeof value !== "number" && FORMULA_PREFIX.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c.key])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function exportFilename(dataset: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");
  return `stabiflow-${dataset.replace(/[^a-z0-9_]/gi, "")}-${stamp}.csv`;
}
