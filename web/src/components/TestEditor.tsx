import type { ParamTest, TestPlacement, ValidationIssue } from "../types";
import { PARAM_NAMES } from "../types";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";

interface Props {
  placement: TestPlacement;
  issues: ValidationIssue[];
  onChange: (next: TestPlacement) => void;
  onDelete: () => void;
}

export function TestEditor({ placement, issues, onChange, onDelete }: Props) {
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
        <NumberField label="Height (mm)" value={t.height_mm} onChange={(v) => updateTest({ height_mm: v })} issue={findIssue("height_mm")} />
        <NumberField label="Gap (mm)" value={t.gap_mm} onChange={(v) => updateTest({ gap_mm: v })} />
        <NumberField label="Rows (wrapping)" value={t.rows} integer min={1} onChange={(v) => updateTest({ rows: v })} />
      </Section>

      <Section title="Base parameters (fixed)">
        <NumberField label="Power %" value={t.base_params.power} onChange={(v) => updateBase({ power: v })} />
        <NumberField label="Speed (mm/s)" value={t.base_params.speed} integer onChange={(v) => updateBase({ speed: v })} />
        <NumberField label="Frequency (Hz)" value={t.base_params.frequency} integer onChange={(v) => updateBase({ frequency: v })} />
        <NumberField label="Lines/cm" value={t.base_params.density} integer onChange={(v) => updateBase({ density: v })} />
        <NumberField label="Passes" value={t.base_params.passes} integer min={1} onChange={(v) => updateBase({ passes: v })} />
        <NumberField label="Pulse width (ns)" value={t.base_params.pulse_width} integer onChange={(v) => updateBase({ pulse_width: v })} />
        <SelectField
          label="Laser"
          value={t.base_params.laser}
          options={[{ value: "red", label: "Red (MOPA)" }, { value: "blue", label: "Blue (diode)" }]}
          onChange={(v) => updateBase({ laser: v })}
        />
      </Section>

      <Section title="Crosshatch (stacked passes)">
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={t.crosshatch_enabled}
            onChange={(e) => updateTest({ crosshatch_enabled: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#555" }}>Enable crosshatch</span>
        </label>
        {t.crosshatch_enabled && (
          <>
            <NumberField
              label="Passes"
              value={t.crosshatch_passes}
              integer
              min={2}
              max={10}
              onChange={(v) => updateTest({ crosshatch_passes: v })}
            />
            <NumberField
              label="Rotation step (°)"
              value={t.crosshatch_step_deg}
              onChange={(v) => updateTest({ crosshatch_step_deg: v })}
            />
          </>
        )}
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
