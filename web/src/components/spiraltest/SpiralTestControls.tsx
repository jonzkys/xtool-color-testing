import type { ReactNode } from "react";
import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { resolveAxis } from "../../lib/forge/spiralTest";
import { Field, Input, Section } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  footprint: { w: number; h: number };
  overBed: boolean;
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

export function SpiralTestControls({ cfg, onChange, footprint, overBed }: Props) {
  const set = <K extends keyof SpiralTestConfig>(k: K, v: SpiralTestConfig[K]) =>
    onChange({ ...cfg, [k]: v });
  const xs = resolveAxis(cfg.channelWidth).map((v) => v.toFixed(2)).join(", ");
  const ys = resolveAxis(cfg.pitch).map((v) => v.toFixed(3)).join(", ");

  return (
    <div className="flex flex-col gap-3">
      <Section title="Grid" dense>
        <AxisHeading>Channel width · X</AxisHeading>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Min">
            <Input aria-label="channel width min" type="number" mono step={0.05} value={cfg.channelWidth.min}
              onChange={(e) => set("channelWidth", { ...cfg.channelWidth, min: num(e.target.value, cfg.channelWidth.min) })} />
          </Field>
          <Field label="Max">
            <Input aria-label="channel width max" type="number" mono step={0.05} value={cfg.channelWidth.max}
              onChange={(e) => set("channelWidth", { ...cfg.channelWidth, max: num(e.target.value, cfg.channelWidth.max) })} />
          </Field>
          <Field label="Steps">
            <Input aria-label="channel width steps" type="number" mono step={1} value={cfg.channelWidth.steps}
              onChange={(e) => set("channelWidth", { ...cfg.channelWidth, steps: num(e.target.value, cfg.channelWidth.steps) })} />
          </Field>
        </div>
        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">CW: {xs}</p>

        <div aria-hidden className="my-2.5 h-px" style={{ background: "var(--metal-bar-soft)" }} />

        <AxisHeading>Pitch · Y</AxisHeading>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Min">
            <Input aria-label="pitch min" type="number" mono step={0.005} value={cfg.pitch.min}
              onChange={(e) => set("pitch", { ...cfg.pitch, min: num(e.target.value, cfg.pitch.min) })} />
          </Field>
          <Field label="Max">
            <Input aria-label="pitch max" type="number" mono step={0.005} value={cfg.pitch.max}
              onChange={(e) => set("pitch", { ...cfg.pitch, max: num(e.target.value, cfg.pitch.max) })} />
          </Field>
          <Field label="Steps">
            <Input aria-label="pitch steps" type="number" mono step={1} value={cfg.pitch.steps}
              onChange={(e) => set("pitch", { ...cfg.pitch, steps: num(e.target.value, cfg.pitch.steps) })} />
          </Field>
        </div>
        <p className="mt-1.5 font-mono text-[10px] tabular-nums text-[color:var(--color-ink-muted)]">Pitch: {ys}</p>
      </Section>

      <Section title="Circle & layout" dense>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Diameter (mm)">
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
          <Field label="Label size (mm)">
            <Input aria-label="label size" type="number" mono step={0.5} value={cfg.label.sizeMm}
              onChange={(e) => set("label", { ...cfg.label, sizeMm: num(e.target.value, cfg.label.sizeMm) })} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2.5 text-[12.5px] text-[color:var(--color-ink-muted)] select-none cursor-pointer">
            <input type="checkbox" className="accent-[color:var(--color-primary)]" checked={cfg.label.show}
              onChange={(e) => set("label", { ...cfg.label, show: e.target.checked })} />
            Labels
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
