import type { ReactNode } from "react";
import type { SpiralTestConfig, CellShape } from "../../lib/forge/spiralTest";
import type { ValidationProfile } from "../../types";
import { PARAMS, PARAM_ORDER, formatValue, type AxisSpec, type ParamKey } from "../../lib/forge/spiralParams";
import { constraintFor, resolveAxisValues, snapStepped, steppedValues } from "../../lib/forge/spiralLimits";
import { Field, Input, Section, Select } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  footprint: { w: number; h: number };
  overBed: boolean;
  profile?: ValidationProfile | null;
}

/** Parse a numeric field, keeping the prior value on empty/NaN (and NOT
 *  clobbering a valid 0, which `parseFloat(v) || fallback` would). */
function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Small mono uppercase heading that labels an axis group. */
function AxisHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink-subtle)]">
      {children}
    </div>
  );
}

export function SpiralTestControls({ cfg, onChange, footprint, overBed, profile = null }: Props) {
  const set = <K extends keyof SpiralTestConfig>(k: K, v: SpiralTestConfig[K]) =>
    onChange({ ...cfg, [k]: v });

  // Switching a param onto an axis resets that axis to the param's default range.
  const setXParam = (key: ParamKey) => onChange({ ...cfg, xParam: key, xAxis: { ...PARAMS[key].defaultAxis } });
  const setYParam = (key: ParamKey) => onChange({ ...cfg, yParam: key, yAxis: { ...PARAMS[key].defaultAxis } });

  const xs = resolveAxisValues(profile, cfg.xParam, cfg.xAxis).map((v) => formatValue(cfg.xParam, v)).join(", ");
  const ys = resolveAxisValues(profile, cfg.yParam, cfg.yAxis).map((v) => formatValue(cfg.yParam, v)).join(", ");

  const axisRange = (
    which: "x" | "y", param: ParamKey, axis: AxisSpec, commit: (a: AxisSpec) => void,
  ) => {
    const opts = steppedValues(profile, param);
    if (opts) {
      // Discrete param: Min/Max are selects of allowed values; Steps is implied
      // by the allowed-in-range count (shown in the readout), so it's omitted.
      return (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min">
            <Select aria-label={`${which} min`} value={String(snapStepped(opts, axis.min))}
              onChange={(e) => commit({ ...axis, min: Number(e.target.value) })}>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </Field>
          <Field label="Max">
            <Select aria-label={`${which} max`} value={String(snapStepped(opts, axis.max))}
              onChange={(e) => commit({ ...axis, max: Number(e.target.value) })}>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </Field>
        </div>
      );
    }
    const c = constraintFor(profile, param);
    const rangeAttrs = c?.kind === "range" ? { min: c.min, max: c.max } : {};
    return (
      <div className="grid grid-cols-3 gap-2">
        <Field label="Min">
          <Input aria-label={`${which} min`} type="number" mono step={PARAMS[param].step} value={axis.min} {...rangeAttrs}
            onChange={(e) => commit({ ...axis, min: num(e.target.value, axis.min) })} />
        </Field>
        <Field label="Max">
          <Input aria-label={`${which} max`} type="number" mono step={PARAMS[param].step} value={axis.max} {...rangeAttrs}
            onChange={(e) => commit({ ...axis, max: num(e.target.value, axis.max) })} />
        </Field>
        <Field label="Steps">
          <Input aria-label={`${which} steps`} type="number" mono step={1} value={axis.steps}
            onChange={(e) => commit({ ...axis, steps: num(e.target.value, axis.steps) })} />
        </Field>
      </div>
    );
  };

  const paramOptions = (exclude: ParamKey) =>
    PARAM_ORDER.filter((k) => k !== exclude).map((k) => (
      <option key={k} value={k}>{PARAMS[k].label} ({PARAMS[k].unit})</option>
    ));

  return (
    <div className="flex flex-col gap-3">
      <Section title="Axes" dense>
        <AxisHeading>X axis</AxisHeading>
        <Field label="Parameter">
          <Select aria-label="x param" value={cfg.xParam}
            onChange={(e) => setXParam(e.target.value as ParamKey)}>
            {paramOptions(cfg.yParam)}
          </Select>
        </Field>
        <div className="mt-2">{axisRange("x", cfg.xParam, cfg.xAxis, (a) => set("xAxis", a))}</div>
        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">X: {xs}</p>

        <div aria-hidden className="my-2.5 h-px" style={{ background: "var(--metal-bar-soft)" }} />

        <AxisHeading>Y axis</AxisHeading>
        <Field label="Parameter">
          <Select aria-label="y param" value={cfg.yParam}
            onChange={(e) => setYParam(e.target.value as ParamKey)}>
            {paramOptions(cfg.xParam)}
          </Select>
        </Field>
        <div className="mt-2">{axisRange("y", cfg.yParam, cfg.yAxis, (a) => set("yAxis", a))}</div>
        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">Y: {ys}</p>
      </Section>

      <Section title="Shape & layout" dense>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Shape" className="col-span-2">
            <Select aria-label="cell shape" value={cfg.cellShape ?? "circle"}
              onChange={(e) => set("cellShape", e.target.value as CellShape)}>
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="diamond">Diamond</option>
              <option value="hexagon">Hexagon</option>
              <option value="octagon">Octagon</option>
              <option value="star">Star</option>
              <option value="letterJ">J</option>
            </Select>
          </Field>
          <Field label="Size (mm)">
            <Input aria-label="diameter" type="number" mono step={0.5} value={cfg.diameterMm}
              onChange={(e) => set("diameterMm", num(e.target.value, cfg.diameterMm))} />
          </Field>
          <Field label="Gap (mm)">
            <Input aria-label="gap" type="number" mono step={0.5} value={cfg.gapMm}
              onChange={(e) => set("gapMm", num(e.target.value, cfg.gapMm))} />
          </Field>
          <Field label="Bed W (mm)">
            <Input aria-label="bed width" type="number" mono step={10} value={cfg.bedMm.w}
              onChange={(e) => set("bedMm", { ...cfg.bedMm, w: num(e.target.value, cfg.bedMm.w) })} />
          </Field>
          <Field label="Bed H (mm)">
            <Input aria-label="bed height" type="number" mono step={10} value={cfg.bedMm.h}
              onChange={(e) => set("bedMm", { ...cfg.bedMm, h: num(e.target.value, cfg.bedMm.h) })} />
          </Field>
          <Field label="Title prefix" className="col-span-2">
            <Input aria-label="title prefix" type="text" value={cfg.labels.titlePrefix}
              onChange={(e) => set("labels", { ...cfg.labels, titlePrefix: e.target.value })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)] select-none cursor-pointer">
            <input type="checkbox" className="accent-[color:var(--color-primary)]" checked={cfg.labels.show}
              onChange={(e) => set("labels", { ...cfg.labels, show: e.target.checked })} />
            Axis labels
          </label>
        </div>
        <p className="mt-1 font-mono text-[11px] tabular-nums"
          style={{ color: overBed ? "var(--color-primary)" : "var(--color-ink-muted)" }}>
          Footprint: {footprint.w.toFixed(0)} × {footprint.h.toFixed(0)} mm{overBed ? " — exceeds bed" : ""}
        </p>
      </Section>
    </div>
  );
}
