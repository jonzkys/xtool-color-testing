import * as React from "react";
import type { ExposureRow } from "./exposureCorrelations";
import type { ModeChoice, ParamKey, SampleableKey } from "./proposeTestMath";

interface RangeReadout {
  paramName: string;
  min: number;
  max: number;
  unit: string;
}

export interface BurnSettings {
  /** Starting scan angle in degrees. 90 = vertical scan (default). */
  scan_angle: number;
  /** When true, each pass burns a perpendicular companion stroke
   *  (doubling delivered energy per cell). v4's compute_indices
   *  factors this in for TEi/AAi/DSi. */
  crosshatch: boolean;
  /** Multi-pass angle behaviour. "fixed" = all passes same angle;
   *  "incremental" = XCS rotates angle between passes. */
  angle_mode: "fixed" | "incremental";
  /** When true, the bitmap-scan mode is oneWay (unidirectional);
   *  otherwise zMode (bi-directional zigzag, default). */
  unidirectional: boolean;
}

export type ParamRow =
  | {
      key: ParamKey | "passes" | "pulse_width";
      kind: "editable";
      value: number;
      min: number;
      max: number;
      step: number;
      unit: string;
      presets?: readonly number[];
    }
  | {
      key: ParamKey | "passes" | "pulse_width";
      kind: "locked";
      resolved: { min: number; max: number };
      anchorValue: number;
      unit: string;
    };

/** Per-varied-param min/max user overrides. Undefined endpoint = use
 *  the active machine's laser limit for that side. */
export type ParamLimitOverrides = Partial<
  Record<SampleableKey, { min?: number; max?: number }>
>;

interface Props {
  anchor: ExposureRow | null;
  entriesInsidePolygon: number;
  mode: ModeChoice;
  onModeChange: (next: ModeChoice) => void;
  cellCount: number;
  onCellCountChange: (n: number) => void;
  paramRows: ReadonlyArray<ParamRow>;
  onParamOverrideChange: (param: ParamKey | "passes" | "pulse_width", value: number) => void;
  /** True when at least one param has been edited from the anchor's value. */
  hasParamOverrides: boolean;
  /** Clears every override → editable rows snap back to the anchor's values. */
  onResetParams: () => void;
  /** Burn settings — non-laser-index params written to the test spec. */
  burnSettings: BurnSettings;
  onBurnSettingChange: <K extends keyof BurnSettings>(key: K, value: BurnSettings[K]) => void;
  rangeReadout: ReadonlyArray<RangeReadout>;
  canCreate: boolean;
  helperText: string | null;
  onCreate: () => void;
  onCancel: () => void;
  /** Use the page's active filters as constraints on the anchor's base
   *  params + the varied params' min/max bounds. When ON, an `eq` clause
   *  freezes that param to the clause value (anchor override), and range
   *  clauses clamp the varied-param limits. */
  useFilters: boolean;
  onUseFiltersChange: (next: boolean) => void;
  /** When ON, ``samplePolygonArea`` is called with an empty knownPoints
   *  array so the sampler doesn't penalise targets near existing entries. */
  ignoreExistingCells: boolean;
  onIgnoreExistingCellsChange: (next: boolean) => void;
  /** Per-param min/max overrides for the varied range. Empty for a param
   *  means "use the active machine limits for that side". */
  paramLimitOverrides: ParamLimitOverrides;
  onParamLimitOverrideChange: (
    param: ParamKey,
    side: "min" | "max",
    value: number | undefined,
  ) => void;
  /** Machine limits for the four varied-eligible params — surfaced so the
   *  CONSTRAINTS section can show defaults in the placeholder. */
  laserLimits: Record<ParamKey, { min: number; max: number; step: number }>;
  /** Crosshatch sampling policy for fill mode. */
  crosshatchPolicy: "varies" | "on" | "off";
  onCrosshatchPolicyChange: (v: "varies" | "on" | "off") => void;
  /** Min/max pass count for fill mode. min === max pins the value. */
  passesRange: { min: number; max: number };
  onPassesRangeChange: (next: { min: number; max: number }) => void;
}

const PARAM_LABEL: Record<string, string> = {
  power: "POWER",
  speed: "SPEED",
  frequency: "FREQ",
  density: "DENSITY",
  passes: "PASSES",
  pulse_width: "PULSE W",
};

function formatValue(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  // Round integers to 0dp, fractional to 2dp, large numbers to 0dp.
  const u = unit ? ` ${unit}` : "";
  if (Math.abs(v) >= 1000) return `${Math.round(v)}${u}`;
  if (Math.abs(v) >= 100) return `${v.toFixed(0)}${u}`;
  if (Math.abs(v) >= 10) return `${v.toFixed(1)}${u}`;
  if (Number.isInteger(v)) return `${v}${u}`;
  return `${v.toFixed(2)}${u}`;
}

export const ExposureProposeRail: React.FC<Props> = ({
  anchor, entriesInsidePolygon, mode, onModeChange, cellCount, onCellCountChange,
  paramRows, onParamOverrideChange,
  hasParamOverrides, onResetParams,
  burnSettings, onBurnSettingChange,
  rangeReadout, canCreate, helperText, onCreate, onCancel,
  useFilters, onUseFiltersChange,
  ignoreExistingCells, onIgnoreExistingCellsChange,
  paramLimitOverrides, onParamLimitOverrideChange, laserLimits,
  crosshatchPolicy, onCrosshatchPolicyChange,
  passesRange, onPassesRangeChange,
}) => {
  const isFill = mode.mode === "fill";

  const toggleMode = (next: "curve" | "fill") => {
    if (next === mode.mode) return;
    if (next === "curve") {
      const param: ParamKey = isFill ? mode.varyParams[0] : mode.varyParam;
      onModeChange({ mode: "curve", varyParam: param });
    } else {
      const first: ParamKey = isFill ? mode.varyParams[0] : mode.varyParam;
      const second: ParamKey = first === "power" ? "speed" : "power";
      onModeChange({ mode: "fill", varyParams: [first, second] });
    }
  };

  const toggleChip = (param: ParamKey) => {
    if (mode.mode === "curve") {
      onModeChange({ mode: "curve", varyParam: param });
    } else {
      const [a, b] = mode.varyParams;
      if (param === a) onModeChange({ mode: "curve", varyParam: b });
      else if (param === b) onModeChange({ mode: "curve", varyParam: a });
      else onModeChange({ mode: "fill", varyParams: [a, param] });
    }
  };

  const isChipSelected = (p: ParamKey) =>
    mode.mode === "curve" ? mode.varyParam === p : mode.varyParams.includes(p);

  return (
    <div className="flex flex-col gap-3 h-full" data-role="propose-rail">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] font-semibold text-[color:var(--color-primary)]">
          Propose Test
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => toggleMode("curve")}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (mode.mode === "curve"
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            curve
          </button>
          <button
            type="button"
            onClick={() => toggleMode("fill")}
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (mode.mode === "fill"
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)]"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
            }
          >
            fill
          </button>
        </div>
      </div>

      <div className="h-px bg-[color:var(--color-border)]" />

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
          Anchor
        </div>
        {anchor ? (
          <>
            <div className="font-mono text-[12px] text-[color:var(--color-ink)]">
              {anchor.hex}
            </div>
            <div className="font-mono text-[10px] text-[color:var(--color-ink-muted)] mt-1">
              {entriesInsidePolygon} entries inside polygon
            </div>
          </>
        ) : (
          <div className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">
            No entries inside polygon yet.
          </div>
        )}
      </section>

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
          Vary
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["power", "speed", "frequency", "density"] as ParamKey[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={isChipSelected(p)}
              onClick={() => toggleChip(p)}
              className={
                "px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] rounded-sm border " +
                (isChipSelected(p)
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                  : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
              }
            >
              {PARAM_LABEL[p]}
            </button>
          ))}
        </div>
      </section>

      <section data-role="propose-params-editor">
        <div className="flex items-center justify-between mb-2">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
            Params
          </div>
          <button
            type="button"
            disabled={!hasParamOverrides}
            onClick={onResetParams}
            data-role="propose-params-reset"
            className={
              "px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] rounded-sm border " +
              (hasParamOverrides
                ? "border-[color:var(--color-primary)] text-[color:var(--color-primary)] cursor-pointer hover:bg-[color:var(--color-primary)]/10"
                : "border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed opacity-50")
            }
            title={hasParamOverrides
              ? "Reset all params to the anchor's values"
              : "No edits to reset"}
          >
            ↺ reset
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {paramRows.map((row) => (
            <div key={row.key} className="flex items-center gap-2 min-w-0" data-row={row.key}>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
                {PARAM_LABEL[row.key as string]}
              </div>
              {row.kind === "editable" ? (
                <>
                  <input
                    type="range"
                    min={row.min}
                    max={row.max}
                    step={row.step}
                    value={row.value}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const snapped = row.presets
                        ? row.presets.reduce((a, b) =>
                            Math.abs(b - raw) < Math.abs(a - raw) ? b : a,
                          )
                        : raw;
                      onParamOverrideChange(row.key, snapped);
                    }}
                    aria-label={`${PARAM_LABEL[row.key as string]} value`}
                    className="flex-1 min-w-0"
                  />
                  <div className="font-mono text-[10px] text-[color:var(--color-ink)] tabular-nums w-[64px] flex-none text-right truncate">
                    {formatValue(row.value, row.unit)}
                  </div>
                </>
              ) : (
                <>
                  <div
                    aria-disabled="true"
                    className="flex-1 min-w-0 h-1.5 rounded-full bg-[color:var(--color-border)] relative overflow-hidden"
                    title={`Locked — varied param. Range ${row.resolved.min}..${row.resolved.max}`}
                  >
                    <div
                      className="absolute top-0 bottom-0 bg-[color:var(--color-primary)]/40"
                      style={{ left: "0%", right: "0%" }}
                    />
                  </div>
                  <div
                    className="font-mono text-[10px] text-[color:var(--color-primary)] tabular-nums w-[96px] flex-none text-right truncate"
                    title={`${formatValue(row.resolved.min, row.unit)} → ${formatValue(row.resolved.max, row.unit)}`}
                  >
                    {formatValue(row.resolved.min, row.unit)}→{formatValue(row.resolved.max, row.unit)}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section data-role="propose-constraints">
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
          Constraints
        </div>
        <div className="flex flex-col gap-2">
          <label
            className="flex items-start gap-2 cursor-pointer"
            data-row="use-filters"
            title="Apply the page's active filter clauses as constraints on this propose-test. Eq clauses fix base params; range/lt/gt clauses clamp the varied param's min/max bounds."
          >
            <input
              type="checkbox"
              checked={useFilters}
              onChange={(e) => onUseFiltersChange(e.target.checked)}
              className="mt-0.5"
              aria-label="Use active filters"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] leading-snug">
              Use active filters
              <span className="block text-[9px] text-[color:var(--color-ink-subtle)] tracking-normal normal-case">
                Eq clauses pin the base value; range clauses clamp the varied limits.
              </span>
            </span>
          </label>

          <label
            className="flex items-start gap-2 cursor-pointer"
            data-row="ignore-existing"
            title="When ON, propose-test samples uniformly across the polygon without penalising targets near existing palette entries."
          >
            <input
              type="checkbox"
              checked={ignoreExistingCells}
              onChange={(e) => onIgnoreExistingCellsChange(e.target.checked)}
              className="mt-0.5"
              aria-label="Ignore existing cells"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] leading-snug">
              Ignore existing cells
              <span className="block text-[9px] text-[color:var(--color-ink-subtle)] tracking-normal normal-case">
                Distribute new cells evenly across the polygon — don't avoid existing entries.
              </span>
            </span>
          </label>

          {/* Per-varied-param min/max overrides. Only rendered when there
              are varied params (curve mode varies 1, fill mode varies 2). */}
          {(() => {
            const varied: ParamKey[] = mode.mode === "curve"
              ? [mode.varyParam]
              : [mode.varyParams[0], mode.varyParams[1]];
            return varied.map((p) => {
              const ov = paramLimitOverrides[p] ?? {};
              const lim = laserLimits[p];
              return (
                <div
                  key={p}
                  className="flex items-center gap-2 min-w-0"
                  data-row={`limits-${p}`}
                >
                  <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
                    {PARAM_LABEL[p]}
                  </div>
                  <input
                    type="number"
                    value={ov.min ?? ""}
                    placeholder={`${lim.min}`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = raw === "" ? undefined : Number(raw);
                      onParamLimitOverrideChange(p, "min", Number.isFinite(n!) ? n : undefined);
                    }}
                    aria-label={`${p} minimum`}
                    className="flex-1 min-w-0 font-mono text-[10px] tabular-nums px-1.5 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
                  />
                  <span aria-hidden className="font-mono text-[10px] text-[color:var(--color-ink-subtle)]">–</span>
                  <input
                    type="number"
                    value={ov.max ?? ""}
                    placeholder={`${lim.max}`}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = raw === "" ? undefined : Number(raw);
                      onParamLimitOverrideChange(p, "max", Number.isFinite(n!) ? n : undefined);
                    }}
                    aria-label={`${p} maximum`}
                    className="flex-1 min-w-0 font-mono text-[10px] tabular-nums px-1.5 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
                  />
                </div>
              );
            });
          })()}

          {/* Crosshatch tri-state */}
          <div className="flex items-center gap-2 min-w-0" data-row="crosshatch-policy">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
              CROSSHATCH
            </div>
            <div className="flex gap-1 flex-1 min-w-0">
              {(["varies", "on", "off"] as const).map((v) => {
                const active = crosshatchPolicy === v;
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={active}
                    aria-label={`Crosshatch ${v}`}
                    onClick={() => onCrosshatchPolicyChange(v)}
                    className={
                      "flex-1 min-w-0 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] rounded-sm border truncate " +
                      (active
                        ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                        : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
                    }
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Passes min/max */}
          <div className="flex items-center gap-2 min-w-0" data-row="passes-range">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
              PASSES
            </div>
            <input
              type="number"
              aria-label="Passes minimum"
              value={passesRange.min}
              min={1}
              max={99}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return;
                const v = Number(raw);
                if (!Number.isFinite(v)) return;
                const clamped = Math.max(1, Math.min(99, Math.round(v)));
                onPassesRangeChange({
                  min: clamped,
                  max: Math.max(clamped, passesRange.max),
                });
              }}
              className="flex-1 min-w-0 font-mono text-[10px] tabular-nums px-1.5 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
            />
            <span aria-hidden className="font-mono text-[10px] text-[color:var(--color-ink-subtle)]">–</span>
            <input
              type="number"
              aria-label="Passes maximum"
              value={passesRange.max}
              min={1}
              max={99}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") return;
                const v = Number(raw);
                if (!Number.isFinite(v)) return;
                const clamped = Math.max(1, Math.min(99, Math.round(v)));
                onPassesRangeChange({
                  min: Math.min(passesRange.min, clamped),
                  max: clamped,
                });
              }}
              className="flex-1 min-w-0 font-mono text-[10px] tabular-nums px-1.5 h-[20px] rounded-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-ink)] focus:outline-none focus:border-[color:var(--color-primary)]"
            />
          </div>
        </div>
      </section>

      <section data-role="propose-burn-settings">
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-2">
          Burn settings
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 min-w-0" data-row="scan_angle">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
              SCAN ANGLE
            </div>
            <input
              type="range"
              min={0} max={360} step={1}
              value={burnSettings.scan_angle}
              onChange={(e) => onBurnSettingChange("scan_angle", Number(e.target.value))}
              aria-label="Scan angle"
              className="flex-1 min-w-0"
            />
            <div className="font-mono text-[10px] text-[color:var(--color-ink)] tabular-nums w-[44px] flex-none text-right">
              {burnSettings.scan_angle}°
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer" data-row="crosshatch">
            <input
              type="checkbox"
              checked={burnSettings.crosshatch}
              onChange={(e) => onBurnSettingChange("crosshatch", e.target.checked)}
              aria-label="Crosshatch"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)]">
              Crosshatch
            </span>
          </label>

          <div className="flex items-center gap-2 min-w-0" data-row="angle_mode">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)] w-[60px] flex-none truncate">
              ANGLE MODE
            </div>
            <div className="flex gap-1 flex-1 min-w-0">
              {([
                { v: "fixed" as const, label: "fixed" },
                { v: "incremental" as const, label: "incr" },
              ]).map(({ v: m, label }) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={burnSettings.angle_mode === m}
                  onClick={() => onBurnSettingChange("angle_mode", m)}
                  title={m}
                  className={
                    "flex-1 min-w-0 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] rounded-sm border truncate " +
                    (burnSettings.angle_mode === m
                      ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                      : "border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer" data-row="unidirectional">
            <input
              type="checkbox"
              checked={burnSettings.unidirectional}
              onChange={(e) => onBurnSettingChange("unidirectional", e.target.checked)}
              aria-label="Unidirectional"
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-muted)]">
              Unidirectional
            </span>
          </label>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-1">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
            Cells · {cellCount}
          </div>
        </div>
        <input
          type="range"
          min={2}
          max={200}
          step={1}
          value={cellCount}
          onChange={(e) => onCellCountChange(Number(e.target.value))}
          aria-label="Cells"
          className="w-full"
        />
        <div className="flex justify-between font-mono text-[8px] text-[color:var(--color-ink-subtle)]">
          <span>2</span>
          <span>200</span>
        </div>
      </section>

      <section>
        <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)] mb-1">
          Range
        </div>
        {rangeReadout.length === 0 ? (
          <div className="font-mono text-[10px] italic text-[color:var(--color-ink-subtle)]">—</div>
        ) : (
          rangeReadout.map((r) => (
            <div key={r.paramName} className="font-mono text-[11px] text-[color:var(--color-ink)]">
              {`${r.paramName} · ${formatValue(r.min, "")} → ${formatValue(r.max, "")} ${r.unit}`}
            </div>
          ))
        )}
      </section>

      <div className="flex-1" />

      {helperText && (
        <div className="font-mono text-[10px] text-[color:var(--color-ink-muted)] italic">
          {helperText}
        </div>
      )}

      <button
        type="button"
        disabled={!canCreate}
        onClick={onCreate}
        className={
          "px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.16em] font-semibold rounded-sm " +
          (canCreate
            ? "bg-[color:var(--color-primary)] text-white"
            : "bg-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed")
        }
      >
        Create Test →
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--color-ink-muted)] border border-[color:var(--color-border)] rounded-sm"
      >
        Cancel
      </button>
    </div>
  );
};

export type { RangeReadout };
