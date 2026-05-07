import { useEffect, useRef, useState } from "react";
import type { Material } from "../library";
import type { Machine, ModeId, ParamName, PaletteEntry, RegistrationMode, SampleAggregator, TestSpec, ValidationCell, ValidationProfile } from "../types";
import { PARAM_NAMES } from "../types";
import { squareCellHeight } from "../specUtils";
import { computeAutoFitGrid, gridHeightToSpecHeight, squareCellAutoFit } from "../autofit";
import { Field, NumberField, Section, Select } from "../ui";
import { PulseWidthSelect } from "./PulseWidthSelect";
import {
  ALLOWED_PULSE_WIDTHS,
  allowedPulseWidthsInRange,
  snapPulseWidth,
} from "../laser/pulseWidths";
import { DynamicParamForm } from "./dynamic-form/DynamicParamForm";
import { useCurrentMachine, getValidationProfile } from "../state/machine";
import { ValidationPaletteTab } from "./ValidationPaletteTab";
import { AnnotationParamsSection } from "./AnnotationParamsSection";

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

/** Base-param fields that can also appear as an X or Y sweep axis.
 *  When swept, the Base-tab field is overridden and should render
 *  disabled with a "swept" caption. Laser is omitted — it's a fixed
 *  enum, not a numeric range, and isn't a valid sweep axis. */
const SWEPTABLE_FIELDS = new Set([
  "power", "speed", "frequency", "density",
  "passes", "pulse_width", "scan_angle",
] as const);

/** If `field` is the X or Y sweep axis, return the human-readable
 *  caption explaining the override. Otherwise return null. */
function sweptByCaption(
  field: string,
  xParam: string,
  yParam: string | null,
): string | null {
  if (!SWEPTABLE_FIELDS.has(field as (typeof SWEPTABLE_FIELDS extends Set<infer T> ? T : never))) return null;
  if (xParam === field) return "Overridden by X-axis sweep";
  if (yParam === field) return "Overridden by Y-axis sweep";
  return null;
}

export type ParamTestEditorTab = "test" | "sweep" | "palette" | "base" | "registration";

interface Props {
  spec: TestSpec;
  onChange: (next: TestSpec) => void;
  locked: boolean;
  issues?: { field: string; message: string; severity: "error" | "warning" }[];
  /** Which tab to render. Caller (TestDetailPage) owns the selection. */
  tab: ParamTestEditorTab;
  /** Test kind. Drives validation-only fields on the Test tab and the
   *  tab list itself. Defaults to "sweep" when omitted. */
  kind?: "sweep" | "validation";
  /** Material picker lives in the Test tab — caller passes options + value + handler. */
  materials: Material[];
  materialId: number | null;
  onMaterialChange: (id: number) => void;
  /** Validation-only: id of the persisted test row (`null` until create
   *  has happened). The palette-tab uses this to PATCH cell selections. */
  testId?: number | null;
  /** Validation-only: persisted picks for this test. Caller mirrors
   *  edits back via `onValidationCellsChange`. Defaults to []. */
  validationCells?: ValidationCell[];
  onValidationCellsChange?: (next: ValidationCell[]) => void;
  /** Validation-only: full palette for the active material. Empty
   *  array is fine — sweep tests don't need this. */
  palette?: PaletteEntry[];
  /** Validation-only: palette entries that the test's picks reference
   *  but that *aren't* in the active source's palette (e.g. picks
   *  made before the user toggled ``source_material_id`` to another
   *  material). Used by ``ValidationPaletteTab`` to render "Picks
   *  from {material}" groups above the picker. */
  crossSourceEntries?: PaletteEntry[];
}

/** Default mode when none is stored — picks the most representative mode
 *  for the machine (color_engrave for F2 Ultra, engrave for everything else). */
function defaultModeFor(machineId: string): ModeId {
  return machineId === "F2Ultra" ? "color_engrave" : "engrave";
}

/** Min/max range a sweep parameter can legally take on the active machine
 *  + mode. Returns null when the param isn't constrained on this profile
 *  (e.g. enum-only fields like `laser` — but those aren't sweepable
 *  anyway). For `pulse_width` use the ALLOWED_PULSE_WIDTHS endpoints
 *  directly — the constraint kind is "stepped" but its endpoints are
 *  the right defaults. */
function paramAxisRange(
  profile: ValidationProfile | null,
  param: ParamName,
): { min: number; max: number } | null {
  if (param === "pulse_width") {
    return {
      min: ALLOWED_PULSE_WIDTHS[0],
      max: ALLOWED_PULSE_WIDTHS[ALLOWED_PULSE_WIDTHS.length - 1],
    };
  }
  const c = profile?.[param];
  if (!c) return null;
  if (c.kind === "range") return { min: c.min, max: c.max };
  if (c.kind === "stepped") {
    const nums = c.values.filter((v): v is number => typeof v === "number");
    if (nums.length > 0) return { min: Math.min(...nums), max: Math.max(...nums) };
  }
  return null;
}

export function ParamTestEditor({
  spec,
  onChange,
  locked,
  issues = [],
  tab,
  kind = "sweep",
  materials,
  materialId,
  onMaterialChange,
  testId = null,
  validationCells = [],
  onValidationCellsChange,
  palette = [],
  crossSourceEntries = [],
}: Props) {
  const t = spec;
  const isValidation = kind === "validation";

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

  // ── Auto-fit state ──────────────────────────────────────────────────
  // Per-test toggle that derives grid width/height from a material
  // shape + size. State is transient (not persisted on the spec) — the
  // visible side-effect is whatever auto-fit writes into spec.width_mm
  // / spec.height_mm, which IS persisted.
  //
  // Default: ON for materials that have a shape with dimensions
  // configured; OFF when the material has no outline to fit against
  // (so the user can hand-pick width/height). Once the user toggles
  // manually, we don't override their choice within the session.
  const [autoFit, setAutoFit] = useState(false);
  const autoFitInitRef = useRef(false);
  type ShapeChoice = "circle" | "rect" | null;
  const [afShape, setAfShape] = useState<ShapeChoice>(null);
  const [afDiameter, setAfDiameter] = useState<number | null>(null);
  const [afWidthMm, setAfWidthMm] = useState<number | null>(null);
  const [afHeightMm, setAfHeightMm] = useState<number | null>(null);
  const [afBufferPct, setAfBufferPct] = useState(2);

  const activeMaterial = materials.find((m) => m.id === materialId) ?? null;
  const materialHasShape = !!activeMaterial?.shape;

  // Whenever the active material changes (or its shape metadata
  // updates), pre-fill the auto-fit panel from it. Editing the panel
  // values doesn't push back to the material — it's per-test
  // override.
  useEffect(() => {
    if (!activeMaterial?.shape) return;
    setAfShape(activeMaterial.shape);
    setAfDiameter(activeMaterial.diameter_mm ?? null);
    setAfWidthMm(activeMaterial.width_mm ?? null);
    setAfHeightMm(activeMaterial.height_mm ?? null);
  }, [
    activeMaterial?.id,
    activeMaterial?.shape,
    activeMaterial?.diameter_mm,
    activeMaterial?.width_mm,
    activeMaterial?.height_mm,
  ]);

  // One-shot default: turn auto-fit ON the first time the active
  // material resolves to one with a shape. Subsequent material
  // changes within the session don't override the user's manual
  // toggle.
  useEffect(() => {
    if (autoFitInitRef.current) return;
    if (!activeMaterial) return;
    autoFitInitRef.current = true;
    if (activeMaterial.shape) setAutoFit(true);
  }, [activeMaterial]);

  // Square-cells auto-height. When auto-fit is also on, the auto-fit
  // recompute below honours square_cells directly (picks a cell side
  // that fits inside the material outline), so this effect skips —
  // otherwise the two effects fight on height_mm.
  useEffect(() => {
    if (autoFit) return;
    if (!t.square_cells) return;
    const target = squareCellHeight(t);
    if (Math.abs(target - t.height_mm) > 0.001) {
      updateSpec({ height_mm: Number(target.toFixed(3)) });
    }
  }, [
    autoFit,
    t.square_cells,
    t.width_mm,
    t.gap_mm,
    t.x_steps,
    t.rows,
    t.y_param,
    t.y_steps,
    t.height_mm,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fit recompute. Fires whenever a relevant input changes and
  // writes spec.width_mm / spec.height_mm to fit the material minus
  // buffer + registration markers. When square_cells is also on, picks
  // the largest square cell that fits the bounds instead of letting
  // the grid fill both axes (which would produce non-square cells).
  useEffect(() => {
    if (!autoFit) return;
    const grid = computeAutoFitGrid({
      shape: afShape,
      diameter_mm: afDiameter,
      width_mm: afWidthMm,
      height_mm: afHeightMm,
      buffer_pct: afBufferPct,
      qr_size_mm: t.registration.qr_size_mm ?? null,
      aruco_size_mm: t.registration.aruco_size_mm ?? null,
      registration_on: t.registration.mode === "on",
    });
    if (!grid) return;
    const is2D = t.y_param !== null && (t.y_steps ?? 1) > 1;
    let width_mm: number;
    let height_mm: number;
    if (t.square_cells) {
      const sq = squareCellAutoFit({
        grid_w: grid.grid_w,
        grid_h: grid.grid_h,
        x_steps: t.x_steps,
        y_steps: t.y_steps ?? 1,
        rows: t.rows ?? 1,
        gap_mm: t.gap_mm,
        hide_axis_labels: t.hide_axis_labels,
        is_2d: is2D,
        // For validation tests, the wrap is driven by ``cells_per_row``
        // and the cell count comes from the picked palette, not the
        // placeholder ``x_steps=1`` we keep on the spec.
        cells_per_row: isValidation ? t.cells_per_row ?? undefined : undefined,
        cell_count: isValidation ? validationCells.length : undefined,
      });
      if (!sq) return;
      width_mm = sq.width_mm;
      height_mm = sq.height_mm;
    } else {
      width_mm = grid.grid_w;
      height_mm = gridHeightToSpecHeight({
        grid_h: grid.grid_h,
        rows: t.rows ?? 1,
        gap_mm: t.gap_mm,
        hide_axis_labels: t.hide_axis_labels,
        is_2d: is2D,
      });
    }
    if (
      Math.abs(t.width_mm - width_mm) > 0.01
      || Math.abs(t.height_mm - height_mm) > 0.01
    ) {
      updateSpec({
        width_mm: Number(width_mm.toFixed(2)),
        height_mm: Number(height_mm.toFixed(3)),
      });
    }
  }, [
    autoFit,
    afShape, afDiameter, afWidthMm, afHeightMm, afBufferPct,
    t.square_cells, t.x_steps, t.gap_mm, t.rows, t.y_param, t.y_steps,
    t.hide_axis_labels,
    t.registration.qr_size_mm, t.registration.aruco_size_mm, t.registration.mode,
    t.width_mm, t.height_mm,
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

          <Section
            title="Auto-fit to material"
            description="When on, derives the grid width and height from the workpiece outline minus buffer + registration markers. Per-test override — pre-fills from the material's default but stays editable here."
            dense
          >
            <label className="flex items-start gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={autoFit}
                disabled={locked}
                onChange={(e) => setAutoFit(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Auto-fit grid to material outline
                <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
                  Width &amp; height become read-only and recompute from the values below.
                </span>
              </span>
            </label>
            {autoFit && !materialHasShape && (
              <div className="rounded-[6px] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-tint)]/60 px-3 py-2 text-[11.5px] text-[color:var(--color-warning)]">
                Material doesn't have a default size — set the shape and dimensions
                below for this test, or update it on the Library page so the next
                test starts pre-filled.
              </div>
            )}
            {autoFit && (
              <>
                <Field label="Shape">
                  <Select
                    value={afShape ?? ""}
                    disabled={locked}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAfShape(v === "circle" || v === "rect" ? v : null);
                    }}
                  >
                    <option value="">— pick a shape —</option>
                    <option value="circle">Circle</option>
                    <option value="rect">Rectangle</option>
                  </Select>
                </Field>
                {afShape === "circle" && (
                  <NumberField
                    label="Diameter (mm)"
                    value={afDiameter ?? 0}
                    min={1} max={1000}
                    disabled={locked}
                    onChange={(v) => setAfDiameter(v)}
                  />
                )}
                {afShape === "rect" && (
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="Width (mm)"
                      value={afWidthMm ?? 0}
                      min={1} max={1000}
                      disabled={locked}
                      onChange={(v) => setAfWidthMm(v)}
                    />
                    <NumberField
                      label="Height (mm)"
                      value={afHeightMm ?? 0}
                      min={1} max={1000}
                      disabled={locked}
                      onChange={(v) => setAfHeightMm(v)}
                    />
                  </div>
                )}
                <div>
                  <label className="flex items-center justify-between text-[12px] text-[color:var(--color-ink-muted)] mb-1">
                    <span>Buffer</span>
                    <span className="font-mono tabular-nums text-[color:var(--color-ink)]">
                      {afBufferPct.toFixed(1)}%
                    </span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={afBufferPct}
                    disabled={locked}
                    onChange={(e) => setAfBufferPct(Number(e.target.value))}
                    className="w-full"
                  />
                  <p className="mt-1 text-[11px] text-[color:var(--color-ink-subtle)]">
                    Empty space to leave on every side, as a percentage of the
                    material's outline. Helps with alignment on the bed.
                  </p>
                </div>
              </>
            )}
          </Section>

          <Section title="Layout">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label={autoFit ? "Width (mm, auto)" : "Width (mm)"}
                value={t.width_mm}
                onChange={(v) => updateSpec({ width_mm: v })}
                issue={findIssue("width_mm")}
                disabled={locked || autoFit}
                help={
                  autoFit
                    ? "Auto-fit drives this from the material outline above."
                    : undefined
                }
              />
              <NumberField
                label={
                  autoFit
                    ? "Height (mm, auto)"
                    : t.square_cells
                      ? "Height (mm, auto)"
                      : "Height (mm)"
                }
                value={t.height_mm}
                onChange={(v) => updateSpec({ height_mm: v })}
                issue={findIssue("height_mm")}
                disabled={locked || t.square_cells || autoFit}
                help={
                  autoFit
                    ? "Auto-fit drives this from the material outline above."
                    : t.square_cells
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
            {isValidation && (
              <NumberField
                label="Cells per row"
                value={t.cells_per_row ?? 6}
                min={1}
                max={50}
                integer
                onChange={(v) => updateSpec({ cells_per_row: v })}
                disabled={locked}
                hint="Wrap the picked palette cells across this many columns. Rows = ceil(cells / cells-per-row)."
              />
            )}
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
                disabled={locked}
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
                onChange={(e) => {
                  const next = e.target.value as ParamName;
                  const range = paramAxisRange(profile, next);
                  updateSpec(
                    range
                      ? { x_param: next, x_min: range.min, x_max: range.max }
                      : { x_param: next },
                  );
                }}
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
              (() => {
                const xRange = paramAxisRange(profile, t.x_param);
                return (
                  <div className="grid grid-cols-3 gap-3">
                    <NumberField
                      label="Min"
                      value={t.x_min}
                      min={xRange?.min}
                      max={xRange?.max}
                      onChange={(v) => updateSpec({ x_min: v })}
                      issue={findIssue("x_min")}
                      disabled={locked}
                    />
                    <NumberField
                      label="Max"
                      value={t.x_max}
                      min={xRange?.min}
                      max={xRange?.max}
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
                );
              })()
            )}
          </Section>

          <Section title="Y axis (optional)">
            <Field label="Parameter">
              <Select
                value={t.y_param ?? ""}
                disabled={locked}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw) {
                    updateSpec({ y_param: null, y_min: null, y_max: null, y_steps: null });
                    return;
                  }
                  const next = raw as ParamName;
                  const range = paramAxisRange(profile, next);
                  updateSpec({
                    y_param: next,
                    y_min: range ? range.min : (t.y_min ?? 0),
                    y_max: range ? range.max : (t.y_max ?? 10),
                    y_steps: t.y_steps ?? 5,
                  });
                }}
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
              (() => {
                const yRange = paramAxisRange(profile, t.y_param);
                return (
                  <div className="grid grid-cols-3 gap-3">
                    <NumberField
                      label="Min"
                      value={t.y_min ?? 0}
                      min={yRange?.min}
                      max={yRange?.max}
                      onChange={(v) => updateSpec({ y_min: v })}
                      disabled={locked}
                    />
                    <NumberField
                      label="Max"
                      value={t.y_max ?? 0}
                      min={yRange?.min}
                      max={yRange?.max}
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
                );
              })()
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

      {tab === "palette" && (
        <ValidationPaletteTab
          testId={testId}
          materialId={materialId}
          materials={materials}
          validationCells={validationCells}
          onValidationCellsChange={onValidationCellsChange ?? (() => {})}
          palette={palette}
          crossSourceEntries={crossSourceEntries}
          sourceMaterialId={spec.source_material_id ?? null}
          onSourceMaterialChange={(next) =>
            updateSpec({ source_material_id: next ?? undefined })
          }
        />
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
            updateBase={updateBase}
            x_param={t.x_param}
            y_param={t.y_param}
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
                <option value="incremental">Incremental — XCS rotates per pass</option>
              </Select>
            </Field>
            <label className="flex items-start gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={t.crosshatch}
                disabled={locked}
                onChange={(e) => updateSpec({ crosshatch: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                Crosshatch
                <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
                  For every pass, also burn a stroke at scan angle + 90°.
                  Stacks with the angle mode above; the device fires
                  twice as many strokes when this is on.
                </span>
              </span>
            </label>
            <p className="text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
              Pass count comes from <strong>Base parameters → Passes</strong>.
              Each pass is one stroke at the current scan angle — XCS
              handles the stacking natively, no rect duplication.
              Crosshatch <strong>doubles</strong> that count: passes=2 +
              crosshatch ⇒ 4 total strokes (alternating 0°/90°).
            </p>
          </Section>
        </>
      )}

      {tab === "registration" && (
        <>
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
        <AnnotationParamsSection
          machineId={machineId}
          machineDisplayName={machine?.display_name ?? machineId}
          materialId={materialId}
          materialName={activeMaterial?.name ?? null}
          locked={locked}
        />
        </>
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
  updateBase,
  x_param,
  y_param,
}: {
  machine: Machine | null;
  currentMode: ModeId;
  locked: boolean;
  setMode: (id: ModeId) => void;
  profile: ValidationProfile | null;
  base_params: TestSpec["base_params"];
  updateBase: (patch: Partial<TestSpec["base_params"]>) => void;
  x_param: TestSpec["x_param"];
  y_param: TestSpec["y_param"];
}) {
  const fieldOverrides: Record<string, string> = {};
  for (const f of ["power", "density", "frequency", "speed", "passes", "pulse_width"]) {
    const cap = sweptByCaption(f, x_param, y_param);
    if (cap) fieldOverrides[f] = cap;
  }

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
              fieldOverrides={fieldOverrides}
            />


            {/* Scan angle — a compact inline readout row */}
            {(() => {
              const scanCaption = sweptByCaption("scan_angle", x_param, y_param);
              return (
                <div>
                  <ScanAngleRow
                    value={base_params.scan_angle ?? 90}
                    onChange={(v) => updateBase({ scan_angle: v })}
                    disabled={locked || scanCaption !== null}
                  />
                  {scanCaption && (
                    <p className="mt-1 text-[10.5px] text-[color:var(--color-ink-subtle)] italic">
                      {scanCaption}
                    </p>
                  )}
                </div>
              );
            })()}
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
                label="Passes"
                value={base_params.passes}
                integer
                min={1}
                step={1}
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
