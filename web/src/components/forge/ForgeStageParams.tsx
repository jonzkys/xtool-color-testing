// web/src/components/forge/ForgeStageParams.tsx
//
// Rough per-stage laser-param overrides, one tab per generated operation. Any
// field left at 0 inherits the source incise object's value on export. The whole
// ForgeConfig (these included) is persisted to localStorage by the page.
import { useState } from "react";
import { Card, CardHeader, CardTitle, Field, NumberField, cn } from "../../ui";
import type { ForgeConfig, StageParams } from "../../lib/forge/types";

export interface ForgeStageParamsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
}

/** The operations that get exported, in process order, as [groupName, label]. */
function stageList(config: ForgeConfig): Array<{ group: string; label: string }> {
  const out: Array<{ group: string; label: string }> = [
    { group: "CUT_01_SEED", label: "Seed" },
    { group: "CUT_02_PERFORATE", label: "Perforate" },
  ];
  for (const g of config.deepen.groups) {
    out.push({ group: g.name, label: g.name.replace(/^CUT_\d+_DEEPEN_/, "Deepen ") });
  }
  out.push({ group: "CUT_07_CLEAN", label: "Clean" });
  return out;
}

/** Subset of StageParams keys that hold a numeric value. */
type NumericStageParamKey = "power" | "speed" | "passes" | "pulseWidth" | "frequency" | "density" | "zLayers" | "zDecline" | "sliceNumber";

const FIELDS: Array<{ key: NumericStageParamKey; label: string; step: number }> = [
  { key: "power", label: "Power (%)", step: 1 },
  { key: "speed", label: "Speed (mm/s)", step: 10 },
  { key: "passes", label: "Passes", step: 1 },
  { key: "zLayers", label: "Z layers", step: 1 },
  { key: "pulseWidth", label: "Pulse width (ns)", step: 10 },
  { key: "frequency", label: "Frequency (kHz)", step: 1 },
];

export function ForgeStageParams({ config, onChange }: ForgeStageParamsProps) {
  const stages = stageList(config);
  // Track the active stage by POSITION, not its (user-editable) group name, so a
  // deepen-group rename keeps the tab on that group instead of silently falling
  // back to Seed.
  const [activeIdx, setActiveIdx] = useState(0);
  const idx = activeIdx < stages.length ? activeIdx : 0;
  const current = stages[idx];
  const params: StageParams = config.stageParams[current?.group ?? ""] ?? {};

  const setParam = (key: NumericStageParamKey, v: number) => {
    const next: StageParams = { ...params };
    if (v > 0) next[key] = v;
    else delete next[key]; // 0 ⇒ inherit source value
    onChange({
      ...config,
      stageParams: { ...config.stageParams, [current.group]: next },
    });
  };

  if (!current) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage parameters (rough — 0 = use source value)</CardTitle>
      </CardHeader>
      <div className="p-2">
        {/* tabs */}
        <div className="flex flex-wrap gap-1 mb-3">
          {stages.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className={cn(
                "px-2 py-1 text-[11px] font-mono uppercase rounded transition-colors",
                i === idx
                  ? "bg-[var(--color-primary)] text-[var(--color-on-primary,#fff)]"
                  : "text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] border border-[var(--color-border)]",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {/* fields for the active stage */}
        <div className="grid grid-cols-3 gap-2">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <NumberField
                value={params[f.key] ?? 0}
                min={0}
                step={f.step}
                onChange={(v) => setParam(f.key, v)}
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-ink-muted)] font-mono">
          {current.group} · overrides apply on export; blank/0 keeps the source incise value.
        </p>
      </div>
    </Card>
  );
}
