import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { CHART_TOOLTIP_STYLE } from "@/lib/dashboard/chartTheme";

export type BarListDatum = { label: string; value: number; color?: string };

/** A horizontal bar list - the one chart form this dashboard needs
 * (magnitude ranking, ordinal funnel stages, and part-to-whole breakdowns
 * are all "compare a few labeled magnitudes", per the dataviz skill's
 * choosing-a-form guide - a pie/donut is deliberately avoided). Each bar
 * carries a direct value label at its tip rather than a numeric axis, to
 * satisfy the categorical palette's contrast relief rule and keep the
 * chart uncluttered. */
export function BarListChart({ data, color, height, title, valueFormatter = String }: {
  data: BarListDatum[];
  /** Single fill for every bar (magnitude/ordinal charts). Omit when each
   * datum carries its own `color` (categorical breakdowns). */
  color?: string;
  height?: number;
  /** Screen-reader label for the hidden data-table equivalent below. */
  title: string;
  valueFormatter?: (value: number) => string;
}) {
  const rowHeight = 32;
  return (
    <>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={height ?? Math.max(120, data.length * rowHeight)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 0 }} barCategoryGap={10}>
            <YAxis
              type="category"
              dataKey="label"
              width={104}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--accent))" }}
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) => [valueFormatter(Number(value)), ""]}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
              <LabelList
                dataKey="value"
                position="right"
                formatter={(value) => valueFormatter(Number(value))}
                fill="hsl(var(--foreground))"
                fontSize={12}
              />
              {data.map((d) => (
                <Cell key={d.label} fill={d.color ?? color ?? "hsl(var(--primary))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* The chart above is aria-hidden - this table is the same data in a
       * form every screen reader and the "view as table" accessibility
       * need can read directly, per the dataviz skill's accessibility pass. */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th>Label</th><th>Value</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{valueFormatter(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
