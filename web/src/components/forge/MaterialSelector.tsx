// web/src/components/forge/MaterialSelector.tsx
// Brass-thickness selector for the Spiral Cut page. Each thickness owns its own
// saved spiral preset + baseline; switching swaps the live config.
import type { MaterialThicknessMm } from "../../lib/forge/types";
import { MATERIAL_THICKNESSES_MM } from "../../lib/forge/types";
import { Card } from "../../ui";

export interface MaterialSelectorProps {
  value: MaterialThicknessMm;
  onChange: (mm: MaterialThicknessMm) => void;
}

export function MaterialSelector({ value, onChange }: MaterialSelectorProps) {
  return (
    <Card padded={false} className="p-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
          Brass
        </span>
        <div role="tablist" aria-label="Brass thickness" className="flex flex-1 gap-1">
          {MATERIAL_THICKNESSES_MM.map((mm) => {
            const active = mm === value;
            return (
              <button
                key={mm}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(mm)}
                className={
                  "flex-1 rounded-[5px] px-2 py-1 font-mono text-[11px] tabular-nums transition-colors " +
                  (active
                    ? "bg-[var(--color-primary)] text-[var(--color-on-primary,#fff)]"
                    : "border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]")
                }
              >
                {mm} mm
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
