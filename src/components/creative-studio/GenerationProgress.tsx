import { Check, Loader2, Circle } from "lucide-react";

export type GenerationStage = "copy" | "concepts" | "visuals" | "render" | "saving" | "done";

const STAGE_LABELS: Record<Exclude<GenerationStage, "done">, string> = {
  copy: "Preparing copy",
  concepts: "Creating concepts",
  visuals: "Generating backgrounds",
  render: "Rendering final ads",
  saving: "Saving to gallery",
};

const STAGE_ORDER: Exclude<GenerationStage, "done">[] = ["copy", "concepts", "visuals", "render", "saving"];

// Business-friendly progress checklist for one-click generation
// (instruction #11). Never mentions OpenAI/RPC/edge functions/canvas -
// only the stage names a non-technical user would recognise.
export function GenerationProgress({
  currentStage,
  visualsSubProgress,
  renderSubProgress,
}: {
  currentStage: GenerationStage;
  visualsSubProgress?: { done: number; total: number } | null;
  renderSubProgress?: { done: number; total: number } | null;
}) {
  const currentIndex = STAGE_ORDER.indexOf(currentStage === "done" ? "saving" : currentStage);

  return (
    <div role="status" className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-sm font-medium">Creating your ads...</p>
      <ul className="space-y-2">
        {STAGE_ORDER.map((stage, i) => {
          const isDone = currentStage === "done" || i < currentIndex;
          const isActive = !isDone && i === currentIndex;
          let suffix = "";
          if (stage === "visuals" && isActive && visualsSubProgress) suffix = ` ${visualsSubProgress.done}/${visualsSubProgress.total}`;
          if (stage === "render" && isActive && renderSubProgress) suffix = ` ${renderSubProgress.done}/${renderSubProgress.total}`;
          return (
            <li key={stage} className="flex items-center gap-2 text-sm">
              {isDone ? (
                <Check className="h-4 w-4 shrink-0 text-success" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className={isDone ? "text-muted-foreground line-through" : isActive ? "font-medium" : "text-muted-foreground"}>
                {STAGE_LABELS[stage]}
                {suffix}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
