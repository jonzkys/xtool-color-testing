import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { defaultHatchPass } from "../defaults";
import type {
  HatchPassSpec,
  HatchRampAxis,
  HatchRampParam,
  HatchRampSpec,
  ValidationIssue,
} from "../types";
import {
  Badge,
  Button,
  Card,
  cn,
  Field,
  IconButton,
  NumberField,
  Section,
  Select,
} from "../ui";

const RAMP_PARAMS: { value: HatchRampParam; label: string }[] = [
  { value: "power", label: "Power %" },
  { value: "speed", label: "Speed mm/s" },
  { value: "frequency", label: "Frequency kHz" },
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
    const next =
      passes.length > 0
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
      param: "power",
      axis: "perp",
      min: 0,
      max: 0,
    };
    updatePass(passIdx, { ramps: [...passes[passIdx].ramps, newRamp] });
  }

  function updateRamp(
    passIdx: number,
    rampIdx: number,
    patch: Partial<HatchRampSpec>,
  ) {
    updatePass(passIdx, {
      ramps: passes[passIdx].ramps.map((r, i) =>
        i === rampIdx ? { ...r, ...patch } : r,
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
    <Section
      title="Hatch passes"
      actions={
        <Button variant="secondary" size="sm" onClick={addPass}>
          <Plus className="h-3.5 w-3.5" />
          Add pass
        </Button>
      }
    >
      {passes.length === 0 && (
        <div className="rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[12.5px] text-[color:var(--color-destructive)]">
          Hatched layer requires at least one pass. Click "Add pass" to start.
        </div>
      )}
      {passes.map((hp, p) => {
        const spacingIssue = issueFor(
          `layers[${layerIdx}].hatch_passes[${p}].spacing`,
        );
        return (
          <Card key={p} variant="elevated" padded={false} className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Badge variant="accent" size="sm">Pass {p + 1}</Badge>
                <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                  {hp.angle}° · {hp.spacing}mm · t{hp.thickness}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  aria-label="Move up"
                  size="sm"
                  variant="ghost"
                  disabled={p === 0}
                  icon={<ArrowUp className="h-3.5 w-3.5" />}
                  onClick={() => movePass(p, -1)}
                />
                <IconButton
                  aria-label="Move down"
                  size="sm"
                  variant="ghost"
                  disabled={p === passes.length - 1}
                  icon={<ArrowDown className="h-3.5 w-3.5" />}
                  onClick={() => movePass(p, 1)}
                />
                <IconButton
                  aria-label="Remove pass"
                  size="sm"
                  variant="ghost"
                  icon={<X className="h-3.5 w-3.5" />}
                  onClick={() => removePass(p)}
                  className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
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
              <NumberField
                label="Thickness (mm)"
                value={hp.thickness}
                onChange={(v) => updatePass(p, { thickness: v })}
              />
            </div>

            <div className="flex items-center justify-between mt-3 mb-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
                Ramps
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addRamp(p)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add ramp
              </Button>
            </div>

            {hp.ramps.length === 0 && (
              <p className="text-[11.5px] text-[color:var(--color-ink-subtle)] italic">
                No ramps — uniform params across the hatch.
              </p>
            )}

            {hp.ramps.map((r, ri) => {
              const rampIssue = issueFor(
                `layers[${layerIdx}].hatch_passes[${p}].ramps[${ri}]`,
              );
              return (
                <div
                  key={ri}
                  className={cn(
                    "rounded-[6px] border bg-[color:var(--color-surface)] p-2 mt-1.5",
                    rampIssue
                      ? "border-[color:var(--color-warning)]/40"
                      : "border-[color:var(--color-border)]",
                  )}
                >
                  <div className="grid grid-cols-[1fr_1fr_80px_80px_auto] gap-2 items-end">
                    <Field label="Param">
                      <Select
                        value={r.param}
                        onChange={(e) =>
                          updateRamp(p, ri, {
                            param: e.target.value as HatchRampParam,
                          })
                        }
                      >
                        {RAMP_PARAMS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Axis">
                      <Select
                        value={r.axis}
                        onChange={(e) =>
                          updateRamp(p, ri, {
                            axis: e.target.value as HatchRampAxis,
                          })
                        }
                      >
                        {RAMP_AXES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
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
                    <IconButton
                      aria-label="Remove ramp"
                      size="sm"
                      variant="ghost"
                      icon={<X className="h-3.5 w-3.5" />}
                      onClick={() => removeRamp(p, ri)}
                      className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
                    />
                  </div>
                  {rampIssue && (
                    <p className="mt-1.5 text-[11.5px] text-[color:var(--color-warning)]">
                      {rampIssue.message}
                    </p>
                  )}
                </div>
              );
            })}
          </Card>
        );
      })}
    </Section>
  );
}
