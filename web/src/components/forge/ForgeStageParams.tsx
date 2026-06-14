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
import { STAGE_GROUPS } from "../../lib/forge/config";
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
  /** Render without the Card/title frame — for embedding in the page's
   *  stage-parameters tray, which provides its own chrome. */
  frameless?: boolean;
  /** Lock to a single stage group and hide the tab strip. (The Spiral page now
   *  uses `cutGroups` instead to show Main/Detail tabs.) */
  lockToGroup?: string;
  /** Cut mode (vector): drop engrave-only controls — Density (lines/cm) and the
   *  generic Z-axis-descent group — and show a single Passes field. A cut steps
   *  focus via Focus descent, not the engrave Z group. For the Spiral page. */
  cutMode?: boolean;
  /** Explicit spiral groups to show as tabs (Spiral page). When provided it
   *  replaces the stageList and is NOT locked to one group. */
  cutGroups?: Array<{ group: string; label: string }>;
}

/** The operations that get exported, in process order, as [groupName, label]. */
function stageList(config: ForgeConfig): Array<{ group: string; label: string }> {
  const out: Array<{ group: string; label: string }> = [
    { group: STAGE_GROUPS.seed, label: "Seed" },
    { group: STAGE_GROUPS.perforate, label: "Perforate" },
  ];
  for (const g of config.deepen.groups) {
    out.push({ group: g.name, label: g.name.replace(/^CUT_\d+_DEEPEN_/, "Deepen ") });
  }
  out.push({ group: STAGE_GROUPS.clean, label: "Clean" });
  if (config.spiral.enabled) {
    out.push({ group: STAGE_GROUPS.spiral, label: "Spiral Cut" });
  }
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

export function ForgeStageParams({ config, onChange, sourceParams, frameless, lockToGroup, cutMode, cutGroups }: ForgeStageParamsProps) {
  const { registry, machineId } = useCurrentMachine();
  const profile = getValidationProfile(registry, machineId, "color_engrave");

  // Cut mode hides engrave-only laser params: Density (lines/cm) and the
  // separate Passes range field (cut passes are the single spiral.passes field).
  const numericFields = cutMode
    ? NUMERIC_FIELDS.filter((f) => f.param !== "density" && f.param !== "passes")
    : NUMERIC_FIELDS;

  // In lockToGroup mode only the one named stage is shown and the tab strip is
  // hidden; otherwise every exported stage gets a tab. cutGroups overrides
  // stageList entirely (Spiral page).
  const allStages = cutGroups ?? stageList(config);
  const stages = lockToGroup ? allStages.filter((s) => s.group === lockToGroup) : allStages;
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
  const isSpiral = current?.group === STAGE_GROUPS.spiral || current?.group === STAGE_GROUPS.spiralDetail;
  const isMainSpiral = current?.group === STAGE_GROUPS.spiral;
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

  // Detail (CUT_09) inherits Main (CUT_08) for un-overridden fields, mirroring
  // resolveStageParams (out[CUT_09] = { ...out[CUT_08], ...overrides }). So the
  // Detail tab must fall back to Main's overrides before the source incise.
  const isDetailSpiral = current.group === STAGE_GROUPS.spiralDetail;
  const mainOverride: StageParams = config.stageParams[STAGE_GROUPS.spiral] ?? {};

  // ── per-field displayed value resolution ──────────────────────────────────
  function numericValue(
    param: "power" | "density" | "frequency" | "speed" | "passes" | "pulseWidth",
    constraint: FieldConstraint | undefined,
  ): number {
    const v = override[param] ?? (isDetailSpiral ? mainOverride[param] : undefined) ?? sourceParams?.[param];
    if (v !== undefined) return v;
    // Fallbacks per kind.
    if (constraint?.kind === "range") return constraint.min;
    if (param === "pulseWidth") return sourceParams?.pulseWidth ?? 200;
    if (constraint?.kind === "stepped") return Number(constraint.values[0]);
    return 0;
  }

  function laserValue(): "red" | "blue" | "uv" {
    return override.laser ?? (isDetailSpiral ? mainOverride.laser : undefined) ?? sourceParams?.laser ?? "red";
  }

  // ── writers (no-op while linked) ──────────────────────────────────────────
  function setParam(key: keyof StageParams, v: number | string | boolean | undefined) {
    if (linkedDeepen) return;
    const next: StageParams = { ...(config.stageParams[current.group] ?? {}) };
    if (v === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = v;
    onChange({
      ...config,
      activePreset: "custom",
      stageParams: { ...config.stageParams, [current.group]: next },
    });
  }

  function setCopyFromFirst(checked: boolean) {
    onChange({
      ...config,
      activePreset: "custom",
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
      activePreset: "custom",
      stageParams: { ...config.stageParams, [current.group]: {} },
    });
  }

  // ── Z-descent values ──────────────────────────────────────────────────────
  const zEnabled = override.zAxisMove ?? sourceParams?.zAxisMove ?? false;
  const zLayers = override.zLayers ?? sourceParams?.zLayers ?? Z_DEFAULTS.zLayers;
  const zDecline = override.zDecline ?? sourceParams?.zDecline ?? Z_DEFAULTS.zDecline;
  // Effective layer count for this stage:
  //  - deepen groups → their toLayer (0→toLayer);
  //  - seed/perforate/clean → their config layerCount (the value that actually
  //    exports now — no longer the source incise's deep sliceNumber).
  const nonDeepenLayerCount =
    current.group === STAGE_GROUPS.seed ? config.seed.layerCount
    : current.group === STAGE_GROUPS.perforate ? config.perforate.layerCount
    : current.group === STAGE_GROUPS.clean ? config.clean.layerCount
    : isMainSpiral ? config.spiral.passes
    : current.group === STAGE_GROUPS.spiralDetail
      ? (config.stageParams[STAGE_GROUPS.spiralDetail]?.passes
          ?? config.stageParams[STAGE_GROUPS.spiral]?.passes
          ?? config.spiral.passes)
    : Z_DEFAULTS.sliceNumber; // unreachable given current stage model; sentinel for future non-deepen stages
  const depthLayers = isDeepen
    ? Math.max(1, config.deepen.groups[deepenIdx].toLayer)
    : nonDeepenLayerCount;
  const totalDepth = descentDepthMm(depthLayers, zLayers, zDecline);
  const depthAt256 = descentDepthMm(256, zLayers, zDecline);

  // Focus-descent depth (cut mode): how far the focus walks down over the run.
  // Mirrors the engrave Z readouts but driven by focusStepMm / focusIntervalPasses.
  const focusTotal = descentDepthMm(config.spiral.passes, config.spiral.focusIntervalPasses, config.spiral.focusStepMm);
  const focusAt256 = descentDepthMm(256, config.spiral.focusIntervalPasses, config.spiral.focusStepMm);

  // Layer count (slices; "Passes" on the spiral tab) — one definition, slotted
  // into the param grid next to Laser in frameless mode, or its own row in the
  // framed layout.
  const layerCountField = !isDeepen ? (
    <Field label={isSpiral ? "Passes" : "Layer count"}>
      <NumberField
        value={nonDeepenLayerCount}
        min={1}
        step={1}
        integer
        onChange={(v) => {
          const n = Math.max(1, v);
          if (current.group === STAGE_GROUPS.seed) onChange({ ...config, seed: { ...config.seed, layerCount: n }, activePreset: "custom" });
          else if (current.group === STAGE_GROUPS.perforate) onChange({ ...config, perforate: { ...config.perforate, layerCount: n }, activePreset: "custom" });
          else if (current.group === STAGE_GROUPS.clean) onChange({ ...config, clean: { ...config.clean, layerCount: n }, activePreset: "custom" });
          else if (current.group === STAGE_GROUPS.spiral) onChange({ ...config, spiral: { ...config.spiral, passes: n }, activePreset: "custom" });
          else if (current.group === STAGE_GROUPS.spiralDetail) setParam("passes", n);
        }}
      />
    </Field>
  ) : null;

  const body = (
      <div className={frameless ? "px-4 py-2.5" : "p-2"}>
        {/* tabs — hidden in lockToGroup (single-stage) mode; shown when >1 stage */}
        {!lockToGroup && stages.length > 1 && (
          <div className={cn("flex flex-wrap gap-1", frameless ? "mb-2" : "mb-3")}>
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
        )}

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
          <div className={cn("grid gap-x-3 gap-y-2", frameless && !cutMode ? "grid-cols-3" : "grid-cols-2")}>
            {numericFields.map(({ snake, param, label, unit }) => {
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
            {frameless && layerCountField}
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
            ).filter((f) => !(cutMode && f.param === "passes")).map(({ param, label, step }) => (
              <Field key={param} label={label}>
                <NumberField
                  value={numericValue(param, undefined)}
                  min={0}
                  step={step}
                  disabled={linkedDeepen}
                  onChange={(v) => setParam(param, v > 0 ? v : undefined)}
                />
              </Field>
            ))}
            {frameless && layerCountField}
          </div>
        )}

        {!frameless && !isDeepen && (
          <div className="mt-3 grid grid-cols-3 gap-2">{layerCountField}</div>
        )}

        {/* Spiral focus descent — the cut's Z mechanism (replaces engrave Z-descent).
            Only on the Main spiral tab; Detail inherits Main's focus settings. */}
        {isMainSpiral && (
          <div className={cn("border border-[var(--color-border)] rounded", frameless ? "mt-2 p-2" : "mt-3 p-2")}>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-subtle)] mb-2">
              Focus descent
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="initial focus (mm)">
                <NumberField
                  value={config.spiral.focusInitialMm ?? 0.01}
                  min={0}
                  step={0.01}
                  onChange={(v) => onChange({ ...config, spiral: { ...config.spiral, focusInitialMm: v >= 0 ? v : 0 }, activePreset: "custom" })}
                />
              </Field>
              <Field label="per step (mm)">
                <NumberField
                  value={config.spiral.focusStepMm}
                  min={0}
                  step={0.01}
                  onChange={(v) => onChange({ ...config, spiral: { ...config.spiral, focusStepMm: v >= 0 ? v : 0 }, activePreset: "custom" })}
                />
              </Field>
              <Field label="every N passes">
                <NumberField
                  value={config.spiral.focusIntervalPasses}
                  min={1}
                  step={1}
                  integer
                  onChange={(v) => onChange({ ...config, spiral: { ...config.spiral, focusIntervalPasses: Math.max(1, v) }, activePreset: "custom" })}
                />
              </Field>
            </div>
            {/* descent depth — total over the configured passes, and at 256 */}
            <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-[11px] text-[var(--color-ink-muted)]">
              <div className="flex items-baseline justify-between gap-2 rounded bg-[var(--color-bg)] px-2 py-1">
                <span className="uppercase tracking-[0.08em] text-[9.5px] text-[var(--color-ink-subtle)]">
                  Total @ {config.spiral.passes}p
                </span>
                <span className="tabular-nums text-[var(--color-ink)]">{focusTotal.toFixed(3)} mm</span>
              </div>
              <div className="flex items-baseline justify-between gap-2 rounded bg-[var(--color-bg)] px-2 py-1">
                <span className="uppercase tracking-[0.08em] text-[9.5px] text-[var(--color-ink-subtle)]">
                  @ 256
                </span>
                <span className="tabular-nums text-[var(--color-ink)]">{focusAt256.toFixed(3)} mm</span>
              </div>
            </div>
          </div>
        )}

        {/* Z-axis descent group — engrave-only; cut mode steps focus instead */}
        {!cutMode && (
        <div className={cn(
          "border border-[var(--color-border)] rounded",
          frameless ? "mt-2 flex flex-wrap items-end gap-x-4 gap-y-1 px-2 py-1.5" : "mt-3 p-2",
        )}>
          <label className={cn(
            "flex items-center gap-2 font-mono text-[11px] text-[var(--color-ink-muted)]",
            frameless && zEnabled && "pb-2.5",
          )}>
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
              <div className={frameless ? "flex items-end gap-2" : "grid grid-cols-2 gap-2 mt-2"}>
                <Field label={frameless ? "Every N" : "Every N layers"} className={frameless ? "w-24" : undefined}>
                  <NumberField
                    value={zLayers}
                    min={1}
                    step={1}
                    integer
                    disabled={linkedDeepen}
                    onChange={(v) => setParam("zLayers", v >= 1 ? v : 1)}
                  />
                </Field>
                <Field label="By mm" className={frameless ? "w-24" : undefined}>
                  <NumberField
                    value={zDecline}
                    min={0}
                    step={0.01}
                    disabled={linkedDeepen}
                    onChange={(v) => setParam("zDecline", v >= 0 ? v : 0)}
                  />
                </Field>
              </div>
              <div className={cn(
                "font-mono text-[11px] text-[var(--color-ink-muted)]",
                frameless ? "flex items-center gap-2 pb-1" : "grid grid-cols-2 gap-2 mt-2",
              )}>
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
        )}

        {/* footer + reset */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-[var(--color-ink-muted)] font-mono">
            {current.group} · overrides apply on export; cleared fields {isDetailSpiral ? "inherit Main" : "use the source incise value"}.
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
  );

  if (frameless) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage parameters</CardTitle>
      </CardHeader>
      {body}
    </Card>
  );
}
