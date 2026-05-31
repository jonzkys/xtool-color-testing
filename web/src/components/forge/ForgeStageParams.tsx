// web/src/components/forge/ForgeStageParams.tsx
//
// Per-stage laser-param overrides, one tab per generated operation. Widgets are
// constrained by the active machine's COLOR_ENGRAVE validation profile (pulse
// width = preset dropdown, power = range slider, laser = enum, etc.) and
// pre-filled from the selected cut target's source incise values. Any field
// left unset inherits the source value on export.
//
// Deepen groups after the first can "Copy from first deepen stage": when on,
// their widgets reflect the FIRST deepen group's overrides and are read-only —
// matching what resolveStageParams() does on export.
//
// The whole ForgeConfig (these included) is persisted to localStorage by the page.
import { useState } from "react";
import { Card, CardHeader, CardTitle, Field, NumberField, cn } from "../../ui";
import type { ForgeConfig, StageParams } from "../../lib/forge/types";
import type { FieldConstraint } from "../../types";
import { useCurrentMachine, getValidationProfile } from "../../state/machine";
import { descentDepthMm } from "../../lib/forge/depth";
import { RangeField } from "../dynamic-form/RangeField";
import { SteppedField } from "../dynamic-form/SteppedField";
import { EnumField } from "../dynamic-form/EnumField";
import { PulseWidthSelect } from "../PulseWidthSelect";

export interface ForgeStageParamsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
  /** Source incise's laser params; widgets pre-fill from these when an
   *  override is unset. */
  sourceParams?: StageParams;
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

/** profile snake_case key ↔ StageParams camelCase numeric/string key. */
const NUMERIC_FIELDS: Array<{
  snake: string;
  param: "power" | "density" | "frequency" | "speed" | "passes" | "pulseWidth";
  label: string;
  unit?: string;
}> = [
  { snake: "power", param: "power", label: "Power", unit: "%" },
  { snake: "density", param: "density", label: "Density", unit: "l/cm" },
  { snake: "frequency", param: "frequency", label: "Frequency", unit: "kHz" },
  { snake: "speed", param: "speed", label: "Speed", unit: "mm/s" },
  { snake: "passes", param: "passes", label: "Passes" },
  { snake: "pulse_width", param: "pulseWidth", label: "Pulse width", unit: "ns" },
];

/** Default values for the Z-descent controls when neither override nor source
 *  supplies one. */
const Z_DEFAULTS = { zLayers: 1, zDecline: 0.01, sliceNumber: 256 } as const;

export function ForgeStageParams({ config, onChange, sourceParams }: ForgeStageParamsProps) {
  const { registry, machineId } = useCurrentMachine();
  const profile = getValidationProfile(registry, machineId, "color_engrave");

  const stages = stageList(config);
  // Track the active stage by POSITION, not its (user-editable) group name, so a
  // deepen-group rename keeps the tab on that group instead of silently falling
  // back to Seed.
  const [activeIdx, setActiveIdx] = useState(0);
  const idx = activeIdx < stages.length ? activeIdx : 0;
  const current = stages[idx];

  // Where this stage sits within the deepen group list (−1 if it isn't one).
  const deepenIdx = current
    ? config.deepen.groups.findIndex((g) => g.name === current.group)
    : -1;
  const isDeepen = deepenIdx >= 0;
  const isDeepenAfterFirst = deepenIdx > 0;
  const firstDeepenName = config.deepen.groups[0]?.name;
  const copyFromFirst = isDeepen ? (config.deepen.groups[deepenIdx].copyParamsFromFirst ?? true) : false;
  // A linked deepen stage mirrors the FIRST deepen group's overrides read-only.
  const linkedDeepen = isDeepenAfterFirst && copyFromFirst;

  // The override map that drives the widgets. For a linked deepen stage that is
  // the FIRST deepen group's overrides (which export copies onto this group).
  const overrideKey = linkedDeepen ? firstDeepenName : current?.group;
  const override: StageParams = (overrideKey ? config.stageParams[overrideKey] : undefined) ?? {};

  if (!current) return null;

  // ── per-field displayed value resolution ──────────────────────────────────
  function numericValue(
    param: "power" | "density" | "frequency" | "speed" | "passes" | "pulseWidth",
    constraint: FieldConstraint | undefined,
  ): number {
    const v = override[param] ?? sourceParams?.[param];
    if (v !== undefined) return v;
    // Fallbacks per kind.
    if (constraint?.kind === "range") return constraint.min;
    if (param === "pulseWidth") return sourceParams?.pulseWidth ?? 200;
    if (constraint?.kind === "stepped") return Number(constraint.values[0]);
    return 0;
  }

  function laserValue(): "red" | "blue" {
    return override.laser ?? sourceParams?.laser ?? "blue";
  }

  // ── writers (no-op while linked) ──────────────────────────────────────────
  function setParam(key: keyof StageParams, v: number | string | boolean | undefined) {
    if (linkedDeepen) return;
    const next: StageParams = { ...(config.stageParams[current.group] ?? {}) };
    if (v === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = v;
    onChange({
      ...config,
      stageParams: { ...config.stageParams, [current.group]: next },
    });
  }

  function setCopyFromFirst(checked: boolean) {
    onChange({
      ...config,
      deepen: {
        ...config.deepen,
        groups: config.deepen.groups.map((g, i) =>
          i === deepenIdx ? { ...g, copyParamsFromFirst: checked } : g,
        ),
      },
    });
  }

  function resetToSource() {
    onChange({
      ...config,
      stageParams: { ...config.stageParams, [current.group]: {} },
    });
  }

  // ── Z-descent values ──────────────────────────────────────────────────────
  const zEnabled = override.zAxisMove ?? sourceParams?.zAxisMove ?? false;
  const zLayers = override.zLayers ?? sourceParams?.zLayers ?? Z_DEFAULTS.zLayers;
  const zDecline = override.zDecline ?? sourceParams?.zDecline ?? Z_DEFAULTS.zDecline;
  const sliceNumber = override.sliceNumber ?? sourceParams?.sliceNumber ?? Z_DEFAULTS.sliceNumber;
  const totalDepth = descentDepthMm(sliceNumber, zLayers, zDecline);
  const depthAt256 = descentDepthMm(256, zLayers, zDecline);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage parameters</CardTitle>
      </CardHeader>
      <div className="p-2">
        {/* tabs */}
        <div className="flex flex-wrap gap-1 mb-3">
          {stages.map((s, i) => (
            <button
              key={i}
              type="button"
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

        {/* "Copy from first deepen stage" — only for deepen groups after the first */}
        {isDeepenAfterFirst && (
          <label className="flex items-center gap-2 mb-3 font-mono text-[11px] text-[var(--color-ink-muted)]">
            <input
              type="checkbox"
              checked={copyFromFirst}
              onChange={(e) => setCopyFromFirst(e.target.checked)}
            />
            Copy from first deepen stage
            {linkedDeepen && firstDeepenName && (
              <span className="text-[10px] text-[var(--color-ink-subtle)]">
                · mirroring {firstDeepenName}
              </span>
            )}
          </label>
        )}

        {/* laser-param fields */}
        {profile ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {NUMERIC_FIELDS.map(({ snake, param, label, unit }) => {
              const c = profile[snake];
              if (!c || c.kind === "not_applicable") return null;
              if (c.kind === "range") {
                return (
                  <RangeField
                    key={param}
                    label={label}
                    unit={unit}
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={numericValue(param, c)}
                    onChange={(v) => setParam(param, v)}
                    disabled={linkedDeepen}
                  />
                );
              }
              if (c.kind === "stepped") {
                if (param === "pulseWidth") {
                  return (
                    <PulseWidthSelect
                      key={param}
                      label={label}
                      value={numericValue(param, c)}
                      onChange={(v) => setParam(param, v)}
                      disabled={linkedDeepen}
                    />
                  );
                }
                return (
                  <SteppedField
                    key={param}
                    label={label}
                    unit={unit}
                    values={c.values}
                    value={numericValue(param, c)}
                    onChange={(v) => setParam(param, v)}
                    disabled={linkedDeepen}
                  />
                );
              }
              return null;
            })}
            {/* laser enum */}
            {(() => {
              const c = profile.laser;
              if (!c || c.kind !== "enum") return null;
              return (
                <EnumField
                  label="Laser"
                  values={c.values}
                  value={laserValue()}
                  onChange={(v) => setParam("laser", v)}
                  disabled={linkedDeepen}
                />
              );
            })()}
          </div>
        ) : (
          // Off-F2 / registry not loaded: fall back to free numeric inputs.
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { param: "power", label: "Power (%)", step: 1 },
                { param: "speed", label: "Speed (mm/s)", step: 10 },
                { param: "passes", label: "Passes", step: 1 },
                { param: "pulseWidth", label: "Pulse width (ns)", step: 10 },
                { param: "frequency", label: "Frequency (kHz)", step: 1 },
              ] as const
            ).map(({ param, label, step }) => (
              <Field key={param} label={label}>
                <NumberField
                  value={override[param] ?? sourceParams?.[param] ?? 0}
                  min={0}
                  step={step}
                  disabled={linkedDeepen}
                  onChange={(v) => setParam(param, v > 0 ? v : undefined)}
                />
              </Field>
            ))}
          </div>
        )}

        {/* Z-axis descent group */}
        <div className="mt-3 border border-[var(--color-border)] rounded p-2">
          <label className="flex items-center gap-2 font-mono text-[11px] text-[var(--color-ink-muted)]">
            <input
              type="checkbox"
              checked={zEnabled}
              disabled={linkedDeepen}
              onChange={(e) => setParam("zAxisMove", e.target.checked)}
            />
            Descend at Z-axis
          </label>
          {zEnabled && (
            <>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <Field label="Every N layers">
                  <NumberField
                    value={zLayers}
                    min={1}
                    step={1}
                    integer
                    disabled={linkedDeepen}
                    onChange={(v) => setParam("zLayers", v >= 1 ? v : 1)}
                  />
                </Field>
                <Field label="By mm">
                  <NumberField
                    value={zDecline}
                    min={0}
                    step={0.01}
                    disabled={linkedDeepen}
                    onChange={(v) => setParam("zDecline", v >= 0 ? v : 0)}
                  />
                </Field>
                <Field label="Slices">
                  <NumberField
                    value={sliceNumber}
                    min={1}
                    step={1}
                    integer
                    disabled={linkedDeepen}
                    onChange={(v) => setParam("sliceNumber", v >= 1 ? v : 1)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-[11px] text-[var(--color-ink-muted)]">
                <div className="flex items-baseline justify-between gap-2 rounded bg-[var(--color-bg)] px-2 py-1">
                  <span className="uppercase tracking-[0.08em] text-[9.5px] text-[var(--color-ink-subtle)]">
                    Total depth
                  </span>
                  <span className="tabular-nums text-[var(--color-ink)]">
                    {totalDepth.toFixed(3)} mm
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 rounded bg-[var(--color-bg)] px-2 py-1">
                  <span className="uppercase tracking-[0.08em] text-[9.5px] text-[var(--color-ink-subtle)]">
                    Depth @ 256
                  </span>
                  <span className="tabular-nums text-[var(--color-ink)]">
                    {depthAt256.toFixed(3)} mm
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* footer + reset */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--color-ink-muted)] font-mono">
            {current.group} · overrides apply on export; cleared fields use the source incise value.
          </p>
          {!linkedDeepen && (
            <button
              type="button"
              onClick={resetToSource}
              className="shrink-0 px-2 py-1 text-[10px] font-mono uppercase rounded border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-fg)] transition-colors"
            >
              Reset to source
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
