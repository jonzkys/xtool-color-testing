import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { defaultHatchPass } from "../defaults";
import type {
  HatchPassSpec, HatchRampSpec, HatchRampAxis, HatchRampParam,
  ValidationIssue,
} from "../types";

const RAMP_PARAMS: { value: HatchRampParam; label: string }[] = [
  { value: "power", label: "Power %" },
  { value: "speed", label: "Speed mm/s" },
  { value: "frequency", label: "Frequency Hz" },
  { value: "density", label: "Density (lines/cm)" },
  { value: "passes", label: "Passes" },
  { value: "pulse_width", label: "Pulse width" },
  { value: "spacing", label: "Spacing (mm)" },
];

const RAMP_AXES: { value: HatchRampAxis; label: string }[] = [
  { value: "perp", label: "Perpendicular to hatch" },
  { value: "parallel", label: "Along hatch" },
  { value: "x", label: "Bbox X" },
  { value: "y", label: "Bbox Y" },
];

export interface HatchPassesEditorProps {
  passes: HatchPassSpec[];
  onChange: (next: HatchPassSpec[]) => void;
  issues: ValidationIssue[];
  layerIdx: number;
}

export function HatchPassesEditor(props: HatchPassesEditorProps) {
  const { passes, onChange, issues, layerIdx } = props;

  function addPass() {
    const lastAngle = passes.length > 0 ? passes[passes.length - 1].angle : 0;
    const next = passes.length > 0
      ? defaultHatchPass((lastAngle + 90) % 360)
      : defaultHatchPass(0);
    onChange([...passes, next]);
  }

  function updatePass(idx: number, patch: Partial<HatchPassSpec>) {
    onChange(passes.map((hp, i) => (i === idx ? { ...hp, ...patch } : hp)));
  }

  function removePass(idx: number) {
    onChange(passes.filter((_, i) => i !== idx));
  }

  function movePass(idx: number, direction: -1 | 1) {
    const target = idx + direction;
    if (target < 0 || target >= passes.length) return;
    const next = [...passes];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  function addRamp(passIdx: number) {
    const newRamp: HatchRampSpec = {
      param: "power", axis: "perp", min: 0, max: 0,
    };
    updatePass(passIdx, { ramps: [...passes[passIdx].ramps, newRamp] });
  }

  function updateRamp(passIdx: number, rampIdx: number, patch: Partial<HatchRampSpec>) {
    updatePass(passIdx, {
      ramps: passes[passIdx].ramps.map(
        (r, i) => (i === rampIdx ? { ...r, ...patch } : r),
      ),
    });
  }

  function removeRamp(passIdx: number, rampIdx: number) {
    updatePass(passIdx, {
      ramps: passes[passIdx].ramps.filter((_, i) => i !== rampIdx),
    });
  }

  function issueFor(field: string): ValidationIssue | undefined {
    return issues.find((i) => i.field === field);
  }

  return (
    <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <strong>Hatch passes</strong>
        <button type="button" onClick={addPass}>+ Add pass</button>
      </div>

      {passes.length === 0 && (
        <div style={{ color: "#a00", fontSize: 13 }}>
          Hatched layer requires at least one pass. Click "+ Add pass" to start.
        </div>
      )}

      {passes.map((hp, p) => {
        const spacingIssue = issueFor(`layers[${layerIdx}].hatch_passes[${p}].spacing`);
        return (
          <div key={p} style={{ marginBottom: 12, padding: 10, border: "1px solid #eee", borderRadius: 4, background: "#fafafa" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong>Pass {p + 1}</strong>
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" disabled={p === 0} onClick={() => movePass(p, -1)} title="Move up">▲</button>
                <button type="button" disabled={p === passes.length - 1} onClick={() => movePass(p, 1)} title="Move down">▼</button>
                <button type="button" onClick={() => removePass(p)} title="Remove pass">✕</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              <NumberField
                label="Angle (°)"
                value={hp.angle}
                onChange={(v) => updatePass(p, { angle: v })}
              />
              <NumberField
                label="Spacing (mm)"
                value={hp.spacing}
                onChange={(v) => updatePass(p, { spacing: v })}
                issue={spacingIssue?.message}
              />
            </div>

            <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <em style={{ fontSize: 13 }}>Ramps</em>
              <button type="button" onClick={() => addRamp(p)}>+ Add ramp</button>
            </div>

            {hp.ramps.length === 0 && (
              <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>(no ramps — uniform params)</div>
            )}

            {hp.ramps.map((r, ri) => {
              const rampIssue = issueFor(`layers[${layerIdx}].hatch_passes[${p}].ramps[${ri}]`);
              return (
                <div key={ri} style={{ marginTop: 6, padding: 6, border: "1px solid #eee", borderRadius: 4, background: "white" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <SelectField
                      label="Param"
                      value={r.param}
                      options={RAMP_PARAMS}
                      onChange={(v) => updateRamp(p, ri, { param: v as HatchRampParam })}
                    />
                    <SelectField
                      label="Axis"
                      value={r.axis}
                      options={RAMP_AXES}
                      onChange={(v) => updateRamp(p, ri, { axis: v as HatchRampAxis })}
                    />
                    <NumberField
                      label="Min"
                      value={r.min}
                      onChange={(v) => updateRamp(p, ri, { min: v })}
                    />
                    <NumberField
                      label="Max"
                      value={r.max}
                      onChange={(v) => updateRamp(p, ri, { max: v })}
                    />
                    <button type="button" onClick={() => removeRamp(p, ri)} title="Remove ramp">✕</button>
                  </div>
                  {rampIssue && (
                    <div style={{ marginTop: 4, color: "#a60", fontSize: 12 }}>
                      {rampIssue.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
