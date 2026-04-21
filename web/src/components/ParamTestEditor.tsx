import { useEffect } from "react";
import type { ParamName, RegistrationMode, TestSpec } from "../types";
import { PARAM_NAMES } from "../types";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { squareCellHeight } from "../specUtils";

interface Props {
  spec: TestSpec;
  onChange: (next: TestSpec) => void;
  locked: boolean;
  issues?: { field: string; message: string; severity: "error" | "warning" }[];
}

export function ParamTestEditor({ spec, onChange, locked, issues = [] }: Props) {
  const t = spec;

  function updateSpec(patch: Partial<TestSpec>) {
    onChange({ ...spec, ...patch });
  }

  function updateBase(patch: Partial<TestSpec["base_params"]>) {
    onChange({ ...spec, base_params: { ...spec.base_params, ...patch } });
  }

  // Keep height_mm in sync with the computed square-cell height whenever
  // any geometry input that feeds the formula changes.
  useEffect(() => {
    if (!t.square_cells) return;
    const target = squareCellHeight(t);
    // Avoid state loops — only patch when the delta is meaningful.
    if (Math.abs(target - t.height_mm) > 0.001) {
      updateSpec({ height_mm: Number(target.toFixed(3)) });
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
    <div style={{ padding: 16 }}>
      <Section title="X axis (required)">
        <SelectField
          label="Parameter"
          value={t.x_param}
          options={PARAM_NAMES}
          onChange={(v) => updateSpec({ x_param: v as ParamName })}
        />
        <NumberField label="Min" value={t.x_min} onChange={(v) => updateSpec({ x_min: v })} issue={findIssue("x_min")} />
        <NumberField label="Max" value={t.x_max} onChange={(v) => updateSpec({ x_max: v })} />
        <NumberField label="Steps" value={t.x_steps} integer min={2} onChange={(v) => updateSpec({ x_steps: v })} issue={findIssue("x_steps")} />
      </Section>

      <Section title="Y axis (optional)">
        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Parameter</span>
          <select
            value={t.y_param ?? ""}
            disabled={locked}
            onChange={(e) => updateSpec({
              y_param: e.target.value ? (e.target.value as ParamName) : null,
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
            <NumberField label="Min" value={t.y_min ?? 0} onChange={(v) => updateSpec({ y_min: v })} />
            <NumberField label="Max" value={t.y_max ?? 0} onChange={(v) => updateSpec({ y_max: v })} />
            <NumberField label="Steps" value={t.y_steps ?? 2} integer min={2} onChange={(v) => updateSpec({ y_steps: v })} />
          </>
        )}
      </Section>

      <Section title="Layout">
        <NumberField label="Width (mm)" value={t.width_mm} onChange={(v) => updateSpec({ width_mm: v })} issue={findIssue("width_mm")} />
        <NumberField
          label={t.square_cells ? "Height (mm, auto)" : "Height (mm)"}
          value={t.height_mm}
          onChange={(v) => updateSpec({ height_mm: v })}
          issue={findIssue("height_mm")}
          help={t.square_cells
            ? "Auto-computed from width + steps + rows + gap to keep cells square. Disable 'Square cells' below to edit directly."
            : undefined}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={t.square_cells}
            disabled={locked}
            onChange={(e) => updateSpec({ square_cells: e.target.checked })}
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
          onChange={(v) => updateSpec({ cell_shape: v as TestSpec["cell_shape"] })}
        />
        {t.cell_shape === "circle" && !t.square_cells && (
          <div style={{ fontSize: 11, color: "#a05000", marginBottom: 8 }}>
            Circle cells render best with Square cells enabled — otherwise
            the inscribed circle leaves unburned metal at the top/bottom and
            the palette sampler may pick up that background.
          </div>
        )}
        <NumberField label="Gap (mm)" value={t.gap_mm} onChange={(v) => updateSpec({ gap_mm: v })} />
        <NumberField label="Rows (wrapping)" value={t.rows} integer min={1} onChange={(v) => updateSpec({ rows: v })} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <input
            type="checkbox"
            checked={t.hide_axis_labels}
            onChange={(e) => updateSpec({ hide_axis_labels: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#555" }}>
            Hide axis labels (saves ~1.75 mm per row gap; header is kept)
          </span>
        </label>
      </Section>

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
        <NumberField
          label="Scan angle (°)"
          value={t.base_params.scan_angle ?? 90}
          onChange={(v) => updateBase({ scan_angle: v })}
          min={0}
          max={360}
          step={5}
          help="Starting scan-line angle. 90 = vertical (default), 0 = horizontal. For crosshatch, the second pass runs at this + 90°; for incremental, XCS rotates from this angle across passes."
        />
      </Section>

      <Section title="Engraving direction">
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={t.unidirectional}
            disabled={locked}
            onChange={(e) => updateSpec({ unidirectional: e.target.checked })}
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
          onChange={(v) => updateSpec({ angle_mode: v as TestSpec["angle_mode"] })}
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
              value={t.registration.mode}
              disabled={locked}
              onChange={(e) => updateSpec({
                registration: {
                  ...t.registration,
                  mode: e.target.value as RegistrationMode,
                },
              })}
              style={{ display: "block", marginTop: 2, padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            >
              <option value="off">Off</option>
              <option value="on">On (QR + ArUcos)</option>
            </select>
          </label>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>
              QR size (mm) — blank = default (5 mm)
            </span>
            <input
              type="number"
              min={2} max={30} step={0.5}
              placeholder="5"
              value={t.registration.qr_size_mm ?? ""}
              disabled={locked || t.registration.mode === "off"}
              onChange={(e) => updateSpec({
                registration: {
                  ...t.registration,
                  qr_size_mm: e.target.value === "" ? null : Number(e.target.value),
                },
              })}
              style={{ display: "block", marginTop: 2, padding: "4px 6px", width: 120, border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            />
          </label>
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>
              ArUco size (mm) — blank = default (2 mm)
            </span>
            <input
              type="number"
              min={1} max={20} step={0.5}
              placeholder="2"
              value={t.registration.aruco_size_mm ?? ""}
              disabled={locked || t.registration.mode === "off"}
              onChange={(e) => updateSpec({
                registration: {
                  ...t.registration,
                  aruco_size_mm: e.target.value === "" ? null : Number(e.target.value),
                },
              })}
              style={{ display: "block", marginTop: 2, padding: "4px 6px", width: 120, border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            />
          </label>
        </div>
        <p style={{ fontSize: 11, color: "#666", margin: 0 }}>
          Burns a QR code (top-left) + 3 ArUco markers at the other corners onto
          the annotation layer so you can photograph the result and auto-extract
          colours. Adjust sizes to suit your substrate and camera resolution.
        </p>
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
