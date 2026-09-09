import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeHexColor, isCompleteHexColor } from "@/lib/workspaceProfile";

// One colour field = one form value, exposed through two synchronized
// controls (native colour picker + free-typed hex text). `invalid` is
// computed by the parent (single source of truth, also gates Save); this
// component only owns WHEN to show that error (not on every keystroke -
// only after the field has been blurred at least once) and the picker's
// "last known good colour" so a temporarily incomplete typed value (e.g.
// "#80") never has to feed <input type="color">, which requires a valid
// colour at all times.
//
// Shared between Settings -> Workspace's legacy Brand Kit summary and
// Creative Studio's Brand Profile editor (the one authoritative editing
// surface - see WorkspaceTab.tsx) so this exact colour-picker UX ships in
// exactly one place.
export function BrandColorField({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
  invalid: boolean;
}) {
  const [touched, setTouched] = useState(false);
  const [lastValidColor, setLastValidColor] = useState("#000000");
  const normalized = value.trim() ? normalizeHexColor(value) : null;
  const complete = isCompleteHexColor(value);
  useEffect(() => {
    if (complete && normalized) setLastValidColor(normalized);
  }, [complete, normalized]);
  const pickerValue = complete && normalized ? normalized : lastValidColor;
  const showError = touched && invalid;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={pickerValue}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          aria-label={`${label} picker`}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-md border p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={showError}
        />
      </div>
      {showError && <p className="text-xs text-destructive">Use a hex colour like {placeholder}.</p>}
    </div>
  );
}
