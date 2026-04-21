import { useEffect } from "react";
import type { ParamTest, QrMode, QrPosition, RegistrationMode, TestPlacement, ValidationIssue } from "../types";
import { PARAM_NAMES } from "../types";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import type { LibraryState } from "../library";
import { MaterialPresetPicker } from "./MaterialPresetPicker";

/**
 * Compute the height_mm that would make every cell square, given the rest
 * of the test geometry. For wrapped 1D tests, cell width is based on the
 * per-row cell count (ceil(x_steps / rows)). For 2D tests, it's based on
 * x_steps directly and the returned height is the total grid height.
 */
function squareCellHeight(t: ParamTest): number {
  const ySteps = t.y_steps ?? 1;
  const is2D = t.y_param !== null && ySteps > 1;
  if (is2D) {
    const cellW = (t.width_mm - Math.max(0, t.x_steps - 1) * t.gap_mm) / t.x_steps;
    return cellW * ySteps + Math.max(0, ySteps - 1) * t.gap_mm;
  }
  const perRow = Math.ceil(t.x_steps / Math.max(1, t.rows));
  return (t.width_mm - Math.max(0, perRow - 1) * t.gap_mm) / perRow;
}

interface Props {
  placement: TestPlacement;
  issues: ValidationIssue[];
  library: LibraryState;
  onChange: (next: TestPlacement) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function TestEditor({ placement, issues, library, onChange, onDelete, onDuplicate }: Props) {
  const t = placement.test;

  function updateTest(patch: Partial<ParamTest>) {
    onChange({ ...placement, test: { ...t, ...patch } });
  }

  function updateBase(patch: Partial<ParamTest["base_params"]>) {
    onChange({ ...placement, test: { ...t, base_params: { ...t.base_params, ...patch } } });
  }

  function updatePlacement(patch: Partial<TestPlacement>) {
    onChange({ ...placement, ...patch });
  }

  // Keep height_mm in sync with the computed square-cell height whenever
  // any geometry input that feeds the formula changes.
  useEffect(() => {
    if (!t.square_cells) return;
    const target = squareCellHeight(t);
    // Avoid state loops — only patch when the delta is meaningful.
    if (Math.abs(target - t.height_mm) > 0.001) {
      updateTest({ height_mm: Number(target.toFixed(3)) });
    }
  }, [
    t.square_cells, t.width_mm, t.gap_mm, t.x_steps, t.rows,
    t.y_param, t.y_steps, t.height_mm,
  ]);  // eslint-disable-line react-hooks/exhaustive-deps

  function findIssue(suffix: string): string | undefined {
    const match = issues.find((i) => i.field.endsWith(suffix));
    return match?.message;
  }

  return (
    <div style={{ padding: 16, overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
        <input
          value={t.name}
          onChange={(e) => updateTest({ name: e.target.value })}
          style={{
            flex: 1, fontSize: 18, padding: "6px 8px",
            border: "1px solid transparent", borderRadius: 4,
          }}
        />
        <button
          onClick={onDuplicate}
          style={{
            marginLeft: 8, padding: "6px 12px",
            background: "#eee", border: "1px solid #ccc",
            borderRadius: 4, color: "#336",
          }}
        >
          Duplicate
        </button>
        <button
          onClick={onDelete}
          style={{
            marginLeft: 8, padding: "6px 12px",
            background: "#eee", border: "1px solid #ccc",
            borderRadius: 4, color: "#a02840",
          }}
        >
          Delete
        </button>
      </div>

      <Section title="X axis (required)">
        <SelectField label="Parameter" value={t.x_param} options={PARAM_NAMES} onChange={(v) => updateTest({ x_param: v })} />
        <NumberField label="Min" value={t.x_min} onChange={(v) => updateTest({ x_min: v })} issue={findIssue("x_min")} />
        <NumberField label="Max" value={t.x_max} onChange={(v) => updateTest({ x_max: v })} />
        <NumberField label="Steps" value={t.x_steps} integer min={2} onChange={(v) => updateTest({ x_steps: v })} issue={findIssue("x_steps")} />
      </Section>

      <Section title="Y axis (optional)">
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Parameter</span>
          <select
            value={t.y_param ?? ""}
            onChange={(e) => updateTest({
              y_param: e.target.value ? (e.target.value as ParamTest["y_param"]) : null,
              y_min: e.target.value ? (t.y_min ?? 0) : null,
              y_max: e.target.value ? (t.y_max ?? 10) : null,
              y_steps: e.target.value ? (t.y_steps ?? 5) : null,
            })}
            style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
          >
            <option value="">None (single axis)</option>
            {PARAM_NAMES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {t.y_param && (
          <>
            <NumberField label="Min" value={t.y_min ?? 0} onChange={(v) => updateTest({ y_min: v })} />
            <NumberField label="Max" value={t.y_max ?? 0} onChange={(v) => updateTest({ y_max: v })} />
            <NumberField label="Steps" value={t.y_steps ?? 2} integer min={2} onChange={(v) => updateTest({ y_steps: v })} />
          </>
        )}
      </Section>

      <Section title="Layout">
        <NumberField label="Width (mm)" value={t.width_mm} onChange={(v) => updateTest({ width_mm: v })} issue={findIssue("width_mm")} />
        <NumberField
          label={t.square_cells ? "Height (mm, auto)" : "Height (mm)"}
          value={t.height_mm}
          onChange={(v) => updateTest({ height_mm: v })}
          issue={findIssue("height_mm")}
          help={t.square_cells
            ? "Auto-computed from width + steps + rows + gap to keep cells square. Disable 'Square cells' below to edit directly."
            : undefined}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={t.square_cells}
            onChange={(e) => updateTest({ square_cells: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#555" }}>Square cells (auto height)</span>
        </label>
        <SelectField
          label="Cell shape"
          value={t.cell_shape}
          options={[
            { value: "rect", label: "Rectangle" },
            { value: "circle", label: "Circle (inscribed)" },
          ]}
          onChange={(v) => updateTest({ cell_shape: v as ParamTest["cell_shape"] })}
        />
        {t.cell_shape === "circle" && !t.square_cells && (
          <div style={{ fontSize: 11, color: "#a05000", marginBottom: 8 }}>
            ⚠ Circle cells render best with Square cells enabled — otherwise
            the inscribed circle leaves unburned metal at the top/bottom and
            the palette sampler may pick up that background.
          </div>
        )}
        <NumberField label="Gap (mm)" value={t.gap_mm} onChange={(v) => updateTest({ gap_mm: v })} />
        <NumberField label="Rows (wrapping)" value={t.rows} integer min={1} onChange={(v) => updateTest({ rows: v })} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={t.hide_axis_labels}
            onChange={(e) => updateTest({ hide_axis_labels: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#555" }}>
            Hide axis labels (saves ~1.75 mm per row gap; header is kept)
          </span>
        </label>
      </Section>

      <MaterialPresetPicker
        library={library}
        materialId={t.material_id}
        baseParams={t.base_params}
        onApply={(materialId, baseParams) => {
          onChange({
            ...placement,
            test: { ...t, material_id: materialId, base_params: { ...baseParams } },
          });
        }}
      />

      <Section title="Base parameters (fixed)">
        <NumberField label="Power %" value={t.base_params.power} onChange={(v) => updateBase({ power: v })} />
        <NumberField label="Speed (mm/s)" value={t.base_params.speed} integer onChange={(v) => updateBase({ speed: v })} />
        <NumberField label="Frequency (Hz)" value={t.base_params.frequency} integer onChange={(v) => updateBase({ frequency: v })} />
        <NumberField label="Lines/cm" value={t.base_params.density} integer onChange={(v) => updateBase({ density: v })} />
        <NumberField
          label={t.angle_mode === "crosshatch" ? "Passes (use even values)" : "Passes"}
          value={t.base_params.passes}
          integer
          min={t.angle_mode === "crosshatch" ? 2 : 1}
          step={t.angle_mode === "crosshatch" ? 2 : 1}
          onChange={(v) => updateBase({ passes: v })}
          help={t.angle_mode === "crosshatch"
            ? "In crosshatch mode each 'pass' is one burn at scan angle and one at +90°. Use even numbers so the total burns match what you enter."
            : undefined}
        />
        <NumberField label="Pulse width (ns)" value={t.base_params.pulse_width} integer onChange={(v) => updateBase({ pulse_width: v })} />
        <SelectField
          label="Laser"
          value={t.base_params.laser}
          options={[{ value: "red", label: "Red (MOPA)" }, { value: "blue", label: "Blue (diode)" }]}
          onChange={(v) => updateBase({ laser: v })}
        />
      </Section>

      <Section title="Engraving direction">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={t.unidirectional}
            onChange={(e) => updateTest({ unidirectional: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#555" }}>
            Uni-directional (burn one way only; slower but avoids backlash artefacts)
          </span>
        </label>
      </Section>

      <Section title="Passes (multi-pass angle)">
        <SelectField
          label="Angle mode"
          value={t.angle_mode}
          options={[
            { value: "fixed", label: "Fixed — all passes at scan angle" },
            { value: "crosshatch", label: "Crosshatch — alternate ±90°" },
            { value: "incremental", label: "Incremental — XCS rotates per pass" },
          ]}
          onChange={(v) => updateTest({ angle_mode: v as ParamTest["angle_mode"] })}
        />
        <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>
          Pass count comes from <strong>Base parameters → Passes</strong>.
          XCS handles the stacking natively; no rect duplication.
          {" "}Crosshatch uses pairs of burns (scan angle + 90°), so every
          two "passes" counts as one XCS cycle — pick even values.
        </div>
      </Section>

      <Section title="Registration marker">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Registration</span>
            <select
              value={t.registration.mode === "off" ? "off" : "on"}
              onChange={(e) => updateTest({
                registration: {
                  ...t.registration,
                  mode: (e.target.value === "off" ? "off" : "compact") as RegistrationMode,
                },
              })}
              style={{ display: "block", marginTop: 2, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            >
              <option value="off">Off</option>
              <option value="on">On (burn QR)</option>
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>QR payload</span>
            <select
              value={t.registration.qr_mode}
              onChange={(e) => updateTest({
                registration: { ...t.registration, qr_mode: e.target.value as QrMode },
              })}
              disabled={t.registration.mode === "off"}
              style={{ display: "block", marginTop: 2, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            >
              <option value="inline">Inline spec</option>
              <option value="id_only">ID only</option>
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>QR position</span>
            <select
              value={t.registration.qr_position}
              onChange={(e) => updateTest({
                registration: { ...t.registration, qr_position: e.target.value as QrPosition },
              })}
              disabled={t.registration.mode === "off"}
              style={{ display: "block", marginTop: 2, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            >
              <option value="top-left">Top-left</option>
              <option value="top-right">Top-right</option>
              <option value="bottom-right">Bottom-right</option>
              <option value="left-middle">Left-middle</option>
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>
              QR size (mm) — blank = default ({t.registration.qr_mode === "inline" ? "12" : "7"})
            </span>
            <input
              type="number"
              min={5} max={30} step={0.5}
              placeholder={t.registration.qr_mode === "inline" ? "12" : "7"}
              value={t.registration.qr_size_mm ?? ""}
              onChange={(e) => updateTest({
                registration: {
                  ...t.registration,
                  qr_size_mm: e.target.value === "" ? null : Number(e.target.value),
                },
              })}
              disabled={t.registration.mode === "off"}
              style={{ display: "block", marginTop: 2, padding: "4px 6px", width: 120, border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            />
          </label>
        </div>
        <p style={{ fontSize: 11, color: "#666", margin: 0 }}>
          Burns a QR code onto the annotation layer so you can photograph the
          result and auto-extract colours. ID-only QR is smaller but requires
          the test to still exist in this browser's local storage when you
          upload the photo. Shrink the QR size to recover substrate space,
          but verify it still scans on your camera.
        </p>
      </Section>

      <Section title="Grid placement">
        <NumberField label="Row" value={placement.row} integer min={0} onChange={(v) => updatePlacement({ row: v })} />
        <NumberField label="Col" value={placement.col} integer min={0} onChange={(v) => updatePlacement({ col: v })} />
        <NumberField label="Col span" value={placement.col_span} integer min={1} onChange={(v) => updatePlacement({ col_span: v })} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
