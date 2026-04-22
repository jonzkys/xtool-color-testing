import { useEffect } from "react";
import type { ParamName, RegistrationMode, TestSpec } from "../types";
import { PARAM_NAMES } from "../types";
import { squareCellHeight } from "../specUtils";
import { Field, NumberField, Section, Select } from "../ui";

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
        {t.y_param && (
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
        )}
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
          <NumberField
            label="Rows (wrapping)"
            value={t.rows}
            integer
            min={1}
            onChange={(v) => updateSpec({ rows: v })}
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

      <Section title="Base parameters (fixed)">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Power %"
            value={t.base_params.power}
            onChange={(v) => updateBase({ power: v })}
          />
          <NumberField
            label="Speed (mm/s)"
            value={t.base_params.speed}
            integer
            onChange={(v) => updateBase({ speed: v })}
          />
          <NumberField
            label="Frequency (Hz)"
            value={t.base_params.frequency}
            integer
            onChange={(v) => updateBase({ frequency: v })}
          />
          <NumberField
            label="Lines/cm"
            value={t.base_params.density}
            integer
            onChange={(v) => updateBase({ density: v })}
          />
          <NumberField
            label={t.angle_mode === "crosshatch" ? "Passes (use even values)" : "Passes"}
            value={t.base_params.passes}
            integer
            min={t.angle_mode === "crosshatch" ? 2 : 1}
            step={t.angle_mode === "crosshatch" ? 2 : 1}
            onChange={(v) => updateBase({ passes: v })}
            help={
              t.angle_mode === "crosshatch"
                ? "In crosshatch mode each 'pass' is one burn at scan angle and one at +90°. Use even numbers so the total burns match what you enter."
                : undefined
            }
          />
          <NumberField
            label="Pulse width (ns)"
            value={t.base_params.pulse_width}
            integer
            onChange={(v) => updateBase({ pulse_width: v })}
          />
          <Field label="Laser">
            <Select
              value={t.base_params.laser}
              onChange={(e) =>
                updateBase({ laser: e.target.value as "red" | "blue" })
              }
            >
              <option value="red">Red (MOPA)</option>
              <option value="blue">Blue (diode)</option>
            </Select>
          </Field>
          <NumberField
            label="Scan angle (°)"
            value={t.base_params.scan_angle ?? 90}
            onChange={(v) => updateBase({ scan_angle: v })}
            min={0}
            max={360}
            step={5}
            help="Starting scan-line angle. 90 = vertical (default), 0 = horizontal. For crosshatch, the second pass runs at this + 90°; for incremental, XCS rotates from this angle across passes."
          />
        </div>
      </Section>

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
    </div>
  );
}
