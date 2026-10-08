import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { useAttributionNames, useTouchSummary, type AttributionTargetType, type TouchSummaryRow } from "@/hooks/useAttribution";
import { confidenceLabel, explainTouch, sourceLabel } from "@/lib/attribution";

const CONFIDENCE_TONE: Record<string, string> = {
  exact: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  high: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  unknown: "bg-muted text-muted-foreground",
};

function TouchLine({ label, row, workspaceId }: { label: string; row: TouchSummaryRow; workspaceId: string | null }) {
  const { data: names } = useAttributionNames(workspaceId, row.campaign_id, row.ad_id, row.creative_id);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}:</span>
        <span className="text-xs">{sourceLabel(row.source)}</span>
        <Badge variant="secondary" className={`text-[10px] ${CONFIDENCE_TONE[row.attribution_confidence || "unknown"]}`}>{confidenceLabel(row.attribution_confidence)}</Badge>
      </div>
      {(names?.campaignName || names?.adName) && (
        <p className="pl-1 text-[11px] text-muted-foreground">
          {names.campaignName && (
            <>
              Campaign:{" "}
              {row.campaign_id ? (
                <Link to={`/app/campaigns/${row.campaign_id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                  {names.campaignName}
                </Link>
              ) : (
                names.campaignName
              )}
            </>
          )}
          {names.campaignName && names.adName && " · "}
          {names.adName && <>Ad: {names.adName}</>}
        </p>
      )}
      <p className="pl-1 text-[11px] text-muted-foreground">{new Date(row.occurred_at).toLocaleString()}</p>
    </div>
  );
}

/**
 * Compact, honest Source section - never fabricates precision. No rows at
 * all is a fully valid state (organic/manual/unknown), rendered as plain
 * text rather than an empty/error state. Used on the Inbox conversation
 * detail (compact) and Lead/Opportunity/Customer detail (full).
 */
export function AttributionSourceSummary({ workspaceId, targetType, targetId, compact, fallbackLabel }: {
  workspaceId: string | null;
  targetType: AttributionTargetType;
  targetId: string | null;
  compact?: boolean;
  fallbackLabel?: string;
}) {
  const { data: rows, isLoading } = useTouchSummary(workspaceId, targetType, targetId);

  if (isLoading) return null;

  const firstTouch = (rows || []).find((r) => r.touch_kind === "first_touch") ?? null;
  const lastTouch = (rows || []).find((r) => r.touch_kind === "last_touch") ?? null;
  const firstPaid = (rows || []).find((r) => r.touch_kind === "first_paid_touch") ?? null;
  const lastPaid = (rows || []).find((r) => r.touch_kind === "last_paid_touch") ?? null;
  const showPaidSeparately = firstPaid && firstPaid.event_id !== firstTouch?.event_id;

  if (!firstTouch) {
    return (
      <div className={compact ? "text-xs text-muted-foreground" : "space-y-1"}>
        <p className="text-xs text-muted-foreground">{fallbackLabel || "No attribution evidence recorded - organic, manual, or unknown source."}</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-1 rounded-md border p-2">
        <TouchLine label="Source" row={lastTouch || firstTouch} workspaceId={workspaceId} />
        <p className="text-[11px] text-muted-foreground">{explainTouch(lastTouch || firstTouch)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <TouchLine label="First touch" row={firstTouch} workspaceId={workspaceId} />
      {lastTouch && lastTouch.event_id !== firstTouch.event_id && <TouchLine label="Last touch" row={lastTouch} workspaceId={workspaceId} />}
      {showPaidSeparately && firstPaid && <TouchLine label="First paid touch" row={firstPaid} workspaceId={workspaceId} />}
      {showPaidSeparately && lastPaid && lastPaid.event_id !== firstPaid?.event_id && <TouchLine label="Last paid touch" row={lastPaid} workspaceId={workspaceId} />}
      <p className="text-[11px] text-muted-foreground">{explainTouch(lastTouch || firstTouch)}</p>
    </div>
  );
}
