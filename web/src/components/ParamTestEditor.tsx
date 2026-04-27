import { useEffect } from "react";
import type { Material } from "../library";
import type { Machine, ModeId, ParamName, RegistrationMode, SampleAggregator, TestSpec, ValidationProfile } from "../types";
import { PARAM_NAMES } from "../types";
import { squareCellHeight } from "../specUtils";
import { Field, NumberField, Section, Select } from "../ui";
import { PulseWidthSelect } from "./PulseWidthSelect";
import {
  ALLOWED_PULSE_WIDTHS,
  allowedPulseWidthsInRange,
  snapPulseWidth,
} from "../laser/pulseWidths";
import { DynamicParamForm } from "./dynamic-form/DynamicParamForm";
import { useCurrentMachine, getValidationProfile } from "../state/machine";

function defaultAggregatorFor(cell_shape: string): SampleAggregator {
  return cell_shape === "circle" ? "median" : "saturation_median";
}

const AGGREGATOR_LABELS: Record<SampleAggregator, string> = {
  median: "median",
  mean: "mean",
  saturation_median: "saturation-biased median",
  trimmed_mean: "trimmed mean (10%)",
  kmeans_dominant: "K-Means dominant cluster",
};

function samplingDescription(cell_shape: string, aggregator?: SampleAggregator): string {
  const region = cell_shape === "circle"
    ? "50% inscribed circle"
    : "60% central rectangle";
  const agg = aggregator ?? defaultAggregatorFor(cell_shape);
  return `${region}, ${AGGREGATOR_LABELS[agg]}`;
}

export type ParamTestEditorTab = "test" | "sweep" | "base" | "registration";

interface Props {
  spec: TestSpec;
  onChange: (next: TestSpec) => void;
  locked: boolean;
  issues?: { field: string; message: string; severity: "error" | "warning" }[];
  /** Which tab to render. Caller (TestDetailPage) owns the selection. */
  tab: ParamTestEditorTab;
  /** Material picker lives in the Test tab — caller passes options + value + handler. */
  materials: Material[];
  materialId: number | null;
  onMaterialChange: (id: number) => void;
}

/** Default mode when none is stored — picks the most representative mode
 *  for the machine (color_engrave for F2 Ultra, engrave for everything else). */
function defaultModeFor(machineId: string): ModeId {
  return machineId === "F2Ultra" ? "color_engrave" : "engrave";
}

export function ParamTestEditor({ spec, onChange, locked, issues = [], tab, materials, materialId, onMaterialChange }: Props) {
  const t = spec;

  // Machine-aware validation profile — used to show/hide base param fields.
  const { registry, machineId, machine } = useCurrentMachine();

  // Derive the active mode from the stored spec, falling back to the
  // machine's representative default. Validated against the machine's
  // supported modes so loading an F2 test on F1 gracefully collapses.
  const storedMode = t.base_params.mode;
  const supportedModes = machine?.modes.map((m) => m.id) ?? [];
  const currentMode: ModeId = (
    storedMode && (supportedModes.length === 0 || supportedModes.includes(storedMode as ModeId))
      ? storedMode as ModeId
      : defaultModeFor(machineId)
  );

  const profile = getValidationProfile(registry, machineId, currentMode);

  function updateSpec(patch: Partial<TestSpec>) {
    onChange({ ...spec, ...patch });
  }
  function updateBase(patch: Partial<TestSpec["base_params"]>) {
    onChange({ ...spec, base_params: { ...spec.base_params, ...patch } });
  }
  function setMode(id: ModeId) {
    updateBase({ mode: id });
  }

  useEffect(() => {
    if (!t.square_cells) return;
    const target = squareCellHeight(t);
    if (Math.abs(target - t.height_mm) > 0.001) {
      updateSpec({ height_mm: Number(target.toFixed(3)) });
    }
  }, [
    t.square_cells,
    t.width_mm,
    t.gap_mm,
    t.x_steps,
    t.rows,
    t.y_param,
    t.y_steps,
    t.height_mm,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  function findIssue(suffix: string): string | undefined {
    const match = issues.find((i) => i.field.endsWith(suffix));
    return match?.message;
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      {tab === "test" && (
        <>
          <Section title="Material">
            <Field label="Material">
              <Select
                value={materialId ?? ""}
                onChange={(e) => onMaterialChange(Number(e.target.value))}
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>

          <Section title="Layout">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Width (mm)"
                value={t.width_mm}
                onChange={(v) => updateSpec({ width_mm: v })}
                issue={findIssue("width_mm")}
                disabled={locked}
              />
              <NumberField
                label={t.square_cells ? "Height (mm, auto)" : "Height (mm)"}
                value={t.height_mm}
                onChange={(v) => updateSpec({ height_mm: v })}
                issue={findIssue("height_mm")}
                disabled={locked || t.square_cells}
                help={
                  t.square_cells
                    ? "Auto-computed from width + steps + rows + gap to keep cells square. Disable 'Square cells' below to edit directly."
                    : undefined
                }
              />
              <NumberField
                label="Gap (mm)"
                value={t.gap_mm}
                onChange={(v) => updateSpec({ gap_mm: v })}
                disabled={locked}
              />
            </div>
            <label className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={t.square_cells}
                disabled={locked}
                onChange={(e) => updateSpec({ square_cells: e.target.checked })}
              />
              Square cells (auto height)
            </label>
            <Field label="Cell shape">
              <Select
                value={t.cell_shape}
                disabled={locked}
                onChange={(e) =>
                  updateSpec({ cell_shape: e.target.value as TestSpec["cell_shape"] })
                }
              >
                <option value="rect">Rectangle</option>
                <option value="circle">Circle (inscribed)</option>
              </Select>
            </Field>
            {t.cell_shape === "circle" && !t.square_cells && (
              <div className="rounded-[6px] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-tint)]/60 px-3 py-2 text-[11.5px] text-[color:var(--color-warning)]">
                Circle cells render best with Square cells enabled — otherwise the
                inscribed circle leaves unburned metal at the top/bottom and the
                palette sampler may pick up that background.
              </div>
            )}
            <Field label="Aggregator">
              <Select
                value={t.sample_aggregator ?? defaultAggregatorFor(t.cell_shape)}
                disabled={locked}
                onChange={(e) =>
                  updateSpec({ sample_aggregator: e.target.value as SampleAggregator })
                }
              >
                <option value="median">Median</option>
                <option value="mean">Mean</option>
                <option value="saturation_median">Saturation-biased median</option>
                <option value="trimmed_mean">Trimmed mean (10%)</option>
                <option value="kmeans_dominant">K-Means dominant cluster</option>
              </Select>
              <p className="mt-1 text-[11px] text-[color:var(--color-ink-subtle)]">
                Sampling: {samplingDescription(t.cell_shape, t.sample_aggregator)}
              </p>
            </Field>
            <label className="flex items-start gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={t.hide_axis_labels}
                onChange={(e) => updateSpec({ hide_axis_labels: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                Hide axis labels
                <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
                  Saves ~1.75 mm per row gap; the header line stays.
                </span>
              </span>
            </label>
          </Section>
        </>
      )}

      {tab === "sweep" && (
        <>
          <Section title="X axis (required)">
            <Field label="Parameter">
              <Select
                value={t.x_param}
                onChange={(e) => updateSpec({ x_param: e.target.value as ParamName })}
                disabled={locked}
              >
                {PARAM_NAMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            {t.x_param === "pulse_width" ? (
              <PulseWidthAxisFields
                min={t.x_min}
                max={t.x_max}
                steps={t.x_steps}
                locked={locked}
                onChange={(patch) => updateSpec(patch as Partial<TestSpec>)}
                fieldPrefix="x"
              />
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <NumberField
                  label="Min"
                  value={t.x_min}
                  onChange={(v) => updateSpec({ x_min: v })}
                  issue={findIssue("x_min")}
                  disabled={locked}
                />
                <NumberField
                  label="Max"
                  value={t.x_max}
                  onChange={(v) => updateSpec({ x_max: v })}
                  disabled={locked}
                />
                <NumberField
                  label="Steps"
                  value={t.x_steps}
                  integer
                  min={2}
                  onChange={(v) => updateSpec({ x_steps: v })}
                  issue={findIssue("x_steps")}
                  disabled={locked}
                />
              </div>
            )}
          </Section>

          <Section title="Y axis (optional)">
            <Field label="Parameter">
              <Select
                value={t.y_param ?? ""}
                disabled={locked}
                onChange={(e) =>
                  updateSpec({
                    y_param: e.target.value ? (e.target.value as ParamName) : null,
                    y_min: e.target.value ? (t.y_min ?? 0) : null,
                    y_max: e.target.value ? (t.y_max ?? 10) : null,
                    y_steps: e.target.value ? (t.y_steps ?? 5) : null,
                  })
                }
              >
                <option value="">None (single axis)</option>
                {PARAM_NAMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            {t.y_param === "pulse_width" ? (
              <PulseWidthAxisFields
                min={t.y_min ?? ALLOWED_PULSE_WIDTHS[0]}
                max={t.y_max ?? ALLOWED_PULSE_WIDTHS[ALLOWED_PULSE_WIDTHS.length - 1]}
                steps={t.y_steps ?? 2}
                locked={locked}
                onChange={(patch) => updateSpec(patch as Partial<TestSpec>)}
                fieldPrefix="y"
              />
            ) : t.y_param ? (
              <div className="grid grid-cols-3 gap-3">
                <NumberField
                  label="Min"
                  value={t.y_min ?? 0}
                  onChange={(v) => updateSpec({ y_min: v })}
                  disabled={locked}
                />
                <NumberField
                  label="Max"
                  value={t.y_max ?? 0}
                  onChange={(v) => updateSpec({ y_max: v })}
                  disabled={locked}
                />
                <NumberField
                  label="Steps"
                  value={t.y_steps ?? 2}
                  integer
                  min={2}
                  onChange={(v) => updateSpec({ y_steps: v })}
                  disabled={locked}
                />
              </div>
            ) : null}
          </Section>

          <Section title="Rows">
            <NumberField
              label="Rows (wrapping)"
              value={t.rows}
              integer
              min={1}
              onChange={(v) => updateSpec({ rows: v })}
              disabled={locked}
            />
          </Section>
        </>
      )}

      {tab === "base" && (
        <>
          <BaseParamsSection
            machine={machine}
            currentMode={currentMode}
            locked={locked}
            setMode={setMode}
            profile={profile}
            base_params={t.base_params}
            angle_mode={t.angle_mode}
            updateBase={updateBase}
          />

          <Section title="Engraving direction">
            <label className="flex items-start gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={t.unidirectional}
                disabled={locked}
                onChange={(e) => updateSpec({ unidirectional: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                Uni-directional burn
                <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
                  One way only; slower but avoids backlash artefacts.
                </span>
              </span>
            </label>
          </Section>

          <Section title="Passes (multi-pass angle)">
            <Field label="Angle mode">
              <Select
                value={t.angle_mode}
                onChange={(e) =>
                  updateSpec({ angle_mode: e.target.value as TestSpec["angle_mode"] })
                }
              >
                <option value="fixed">Fixed — all passes at scan angle</option>
                <option value="crosshatch">Crosshatch — alternate ±90°</option>
                <option value="incremental">Incremental — XCS rotates per pass</option>
              </Select>
            </Field>
            <p className="text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
              Pass count comes from <strong>Base parameters → Passes</strong>. XCS
              handles the stacking natively; no rect duplication. Crosshatch uses
              pairs of burns (scan angle + 90°), so every two "passes" counts as
              one XCS cycle — pick even values.
            </p>
          </Section>
        </>
      )}

      {tab === "registration" && (
        <Section title="Registration marker">
          <Field label="Registration">
            <Select
              value={t.registration.mode}
              disabled={locked}
              onChange={(e) =>
                updateSpec({
                  registration: {
                    ...t.registration,
                    mode: e.target.value as RegistrationMode,
                  },
                })
              }
            >
              <option value="off">Off</option>
              <option value="on">On (QR + ArUcos)</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="QR size (mm)" hint="blank = default (5 mm)">
              <input
                type="number"
                min={2}
                max={30}
                step={0.5}
                placeholder="5"
                value={t.registration.qr_size_mm ?? ""}
                disabled={locked || t.registration.mode === "off"}
                onChange={(e) =>
                  updateSpec({
                    registration: {
                      ...t.registration,
                      qr_size_mm: e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
                className="block w-full h-9 rounded-[6px] px-3 text-[13px] font-mono bg-[color:var(--color-surface)] border border-[color:var(--color-border-strong)] hover:border-[color:var(--color-ink-subtle)] focus:outline-none focus:border-[color:var(--color-primary)] focus:ring-2 focus:ring-[color:var(--color-primary-tint)] disabled:opacity-50 disabled:bg-[color:var(--color-bg)]"
              />
            </Field>
            <Field label="ArUco size (mm)" hint="blank = default (2 mm)">
              <input
                type="number"
                min={1}
                max={20}
                step={0.5}
                placeholder="2"
                value={t.registration.aruco_size_mm ?? ""}
                disabled={locked || t.registration.mode === "off"}
                onChange={(e) =>
                  updateSpec({
                    registration: {
                      ...t.registration,
                      aruco_size_mm:
                        e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
                className="block w-full h-9 rounded-[6px] px-3 text-[13px] font-mono bg-[color:var(--color-surface)] border border-[color:var(--color-border-strong)] hover:border-[color:var(--color-ink-subtle)] focus:outline-none focus:border-[color:var(--color-primary)] focus:ring-2 focus:ring-[color:var(--color-primary-tint)] disabled:opacity-50 disabled:bg-[color:var(--color-bg)]"
              />
            </Field>
          </div>
          <p className="text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
            Burns a QR (top-left) + 3 ArUco markers at the other corners onto
            the annotation layer so you can photograph the result and
            auto-extract colours. Adjust sizes to suit your substrate and
            camera resolution.
          </p>
        </Section>
      )}
    </div>
  );
}

/** Axis-fields for ``pulse_width``-swept axes. The laser only accepts a
 *  preset list, so we can't use a free-form min/max + steps form — we
 *  render three dropdowns constrained to the preset values and cap the
 *  step count to the number of presets inside the selected range.
 *
 *  ``fieldPrefix`` is ``"x"`` or ``"y"``; the component emits
 *  ``updateSpec({ [prefix_min]: ..., [prefix_max]: ..., [prefix_steps]: ... })``
 *  patches so the parent's single updateSpec handler stays unchanged.
 */
function PulseWidthAxisFields({
  min,
  max,
  steps,
  locked,
  onChange,
  fieldPrefix,
}: {
  min: number;
  max: number;
  steps: number;
  locked: boolean;
  onChange: (patch: Record<string, number>) => void;
  fieldPrefix: "x" | "y";
}) {
  const snappedMin = snapPulseWidth(min);
  const snappedMax = snapPulseWidth(max);
  // Effective range used for the step cap — always keep min ≤ max.
  const lo = Math.min(snappedMin, snappedMax);
  const hi = Math.max(snappedMin, snappedMax);
  const inRange = allowedPulseWidthsInRange(lo, hi);
  const maxSteps = Math.max(2, inRange.length);
  const clampedSteps = Math.max(2, Math.min(steps, maxSteps));
  const exceeded = steps > maxSteps;

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Min">
          <Select
            value={String(snappedMin)}
            disabled={locked}
            onChange={(e) =>
              onChange({ [`${fieldPrefix}_min`]: Number(e.target.value) })
            }
          >
            {ALLOWED_PULSE_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Max">
          <Select
            value={String(snappedMax)}
            disabled={locked}
            onChange={(e) =>
              onChange({ [`${fieldPrefix}_max`]: Number(e.target.value) })
            }
          >
            {ALLOWED_PULSE_WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </Select>
        </Field>
        <NumberField
          label={`Steps (max ${maxSteps})`}
          value={clampedSteps}
          integer
          min={2}
          max={maxSteps}
          disabled={locked}
          onChange={(v) =>
            onChange({
              [`${fieldPrefix}_steps`]: Math.max(2, Math.min(v, maxSteps)),
            })
          }
        />
      </div>
      {exceeded && (
        <p className="mt-2 font-mono text-[11px] text-[color:var(--color-primary)]">
          Capped to {maxSteps} — the MOPA only has that many preset widths
          between {lo} and {hi} ns. Widen the range or lower the step
          count.
        </p>
      )}
      <p className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
        Pulse width is quantised to the F2 Ultra's preset list
        (2, 4, 6, 9, 13, 20, 30, 45, 60, 80, 100, 150, 200, 250, 350, 500).
      </p>
    </>
  );
}

// ── BaseParamsSection ─────────────────────────────────────────────────────────

/**
 * The redesigned "Base parameters (fixed)" section.
 *
 * Visual strategy:
 * - A segmented control at the top for mode selection — one click, no dropdown.
 *   The active mode pill has an ember-filled background.
 * - The burn recipe fields (power, density, frequency, speed, passes, laser,
 *   pulse_width) are rendered by DynamicParamForm in a mixed full-width /
 *   2-column grid layout for density of information on wider panels.
 * - Scan angle rendered below the main recipe with a compact inline treatment.
 */
function BaseParamsSection({
  machine,
  currentMode,
  locked,
  setMode,
  profile,
  base_params,
  angle_mode,
  updateBase,
}: {
  machine: Machine | null;
  currentMode: ModeId;
  locked: boolean;
  setMode: (id: ModeId) => void;
  profile: ValidationProfile | null;
  base_params: TestSpec["base_params"];
  angle_mode: TestSpec["angle_mode"];
  updateBase: (patch: Partial<TestSpec["base_params"]>) => void;
}) {
  return (
    <section className="flex flex-col">
      {/* Section header */}
      <header className="flex items-end justify-between gap-x-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            Base parameters
          </div>
        </div>
      </header>
      {/* Metal bar divider */}
      <div
        aria-hidden="true"
        className="h-px w-full mb-3"
        style={{ background: "var(--metal-bar-soft)" }}
      />

      <div className="flex flex-col gap-4">
        {/* Mode segmented control */}
        {machine && (
          <ModeSegmentedControl
            modes={machine.modes}
            value={currentMode}
            disabled={locked}
            onChange={setMode}
          />
        )}

        {/* Burn recipe fields */}
        {profile ? (
          <>
            <DynamicParamForm
              profile={profile}
              value={base_params as unknown as Record<string, number | string>}
              onChange={(next) =>
                updateBase(next as Partial<TestSpec["base_params"]>)
              }
              disabled={locked}
            />

            {/* Crosshatch pass hint */}
            {angle_mode === "crosshatch" && (
              <p className="text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
                In crosshatch mode each pass is one burn at scan angle and one
                at +90°. Use even pass counts so the total burns match what you
                enter.
              </p>
            )}

            {/* Scan angle — a compact inline readout row */}
            <ScanAngleRow
              value={base_params.scan_angle ?? 90}
              onChange={(v) => updateBase({ scan_angle: v })}
              disabled={locked}
            />
          </>
        ) : (
          /* Profile not yet loaded — render the static fallback form. */
          <div className="flex flex-col gap-3">
            <p className="font-mono text-[11px] tracking-[0.04em] text-[color:var(--color-ink-subtle)]">
              Loading constraints…
            </p>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Power %"
                value={base_params.power}
                onChange={(v) => updateBase({ power: v })}
              />
              <NumberField
                label="Speed (mm/s)"
                value={base_params.speed}
                integer
                onChange={(v) => updateBase({ speed: v })}
              />
              <NumberField
                label="Frequency (kHz)"
                value={base_params.frequency}
                integer
                onChange={(v) => updateBase({ frequency: v })}
              />
              <NumberField
                label="Lines/cm"
                value={base_params.density}
                integer
                onChange={(v) => updateBase({ density: v })}
              />
              <NumberField
                label={angle_mode === "crosshatch" ? "Passes (even)" : "Passes"}
                value={base_params.passes}
                integer
                min={angle_mode === "crosshatch" ? 2 : 1}
                step={angle_mode === "crosshatch" ? 2 : 1}
                onChange={(v) => updateBase({ passes: v })}
              />
              <PulseWidthSelect
                value={base_params.pulse_width}
                onChange={(v) => updateBase({ pulse_width: v })}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Mode segmented control ───────────────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
  engrave:       "Engrave",
  score:         "Score",
  cut:           "Cut",
  color_engrave: "Color Engrave",
};

function ModeSegmentedControl({
  modes,
  value,
  disabled,
  onChange,
}: {
  modes: { id: ModeId; profile: string }[];
  value: ModeId;
  disabled: boolean;
  onChange: (id: ModeId) => void;
}) {
  return (
    <div
      className="flex gap-[3px] p-[3px] rounded-[8px]"
      style={{ background: "var(--color-border)" }}
      role="radiogroup"
      aria-label="Laser mode"
    >
      {modes.map((m) => {
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !disabled && onChange(m.id)}
            disabled={disabled}
            className="flex-1 rounded-[6px] font-mono font-semibold transition-all focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-default whitespace-nowrap px-1"
            style={{
              fontSize: "10px",
              height: "28px",
              background: active ? "var(--color-primary)" : "transparent",
              color: active ? "#fff" : "var(--color-ink-muted)",
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.18)" : "none",
              // Letterspacing tightened from 0.06em so "COLOR ENGRAVE"
              // fits on one line in the equal-share pill.
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              border: "none",
            }}
          >
            {MODE_LABELS[m.id] ?? m.id.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

// ── Scan angle compact row ───────────────────────────────────────────────────

function ScanAngleRow({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-[6px] px-3 py-2 border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface-elevated)",
      }}
    >
      <span
        className="font-mono font-semibold uppercase tracking-[0.1em] shrink-0"
        style={{ fontSize: "9.5px", color: "var(--color-ink-subtle)" }}
      >
        Scan angle
      </span>
      <div className="flex-1" />
      {/* Preset angle pills */}
      <div className="flex gap-1">
        {[0, 45, 90, 135].map((deg) => (
          <button
            key={deg}
            type="button"
            onClick={() => !disabled && onChange(deg)}
            disabled={disabled}
            className="font-mono tabular-nums rounded-[4px] px-2 transition-all focus:outline-none focus-visible:ring-1 disabled:opacity-50"
            style={{
              fontSize: "10.5px",
              height: "22px",
              background: value === deg ? "var(--color-primary-tint)" : "var(--color-border)",
              color: value === deg ? "var(--color-primary)" : "var(--color-ink-muted)",
              border: value === deg ? "1px solid var(--color-primary)/40" : "1px solid transparent",
              fontWeight: value === deg ? 700 : 500,
            }}
          >
            {deg}°
          </button>
        ))}
      </div>
      {/* Direct numeric input */}
      <input
        type="number"
        min={0}
        max={360}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(360, n)));
        }}
        className="font-mono tabular-nums text-right rounded-[4px] px-2 focus:outline-none border disabled:opacity-50"
        style={{
          fontSize: "11px",
          height: "22px",
          width: "52px",
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          borderColor: "var(--color-border-strong)",
        }}
      />
      <span
        className="font-mono uppercase tracking-[0.06em] shrink-0"
        style={{ fontSize: "9px", color: "var(--color-ink-subtle)" }}
      >
        °
      </span>
    </div>
  );
}
