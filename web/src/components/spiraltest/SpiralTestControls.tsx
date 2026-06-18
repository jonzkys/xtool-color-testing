import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { resolveAxis } from "../../lib/forge/spiralTest";
import { Field, Section } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  footprint: { w: number; h: number };
  overBed: boolean;
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function SpiralTestControls({ cfg, onChange, footprint, overBed }: Props) {
  const set = <K extends keyof SpiralTestConfig>(k: K, v: SpiralTestConfig[K]) =>
    onChange({ ...cfg, [k]: v });
  const xs = resolveAxis(cfg.channelWidth).map((v) => v.toFixed(2)).join(", ");
  const ys = resolveAxis(cfg.pitch).map((v) => v.toFixed(3)).join(", ");

  return (
    <div className="flex flex-col gap-4">
      <Section title="Grid" dense>
        <div className="grid grid-cols-3 gap-2">
          <Field label="CW min"><input aria-label="channel width min" type="number" step="0.05" value={cfg.channelWidth.min}
            onChange={(e) => set("channelWidth", { ...cfg.channelWidth, min: num(e.target.value, cfg.channelWidth.min) })} /></Field>
          <Field label="CW max"><input aria-label="channel width max" type="number" step="0.05" value={cfg.channelWidth.max}
            onChange={(e) => set("channelWidth", { ...cfg.channelWidth, max: num(e.target.value, cfg.channelWidth.max) })} /></Field>
          <Field label="CW steps"><input aria-label="channel width steps" type="number" step="1" value={cfg.channelWidth.steps}
            onChange={(e) => set("channelWidth", { ...cfg.channelWidth, steps: num(e.target.value, cfg.channelWidth.steps) })} /></Field>
          <Field label="Pitch min"><input aria-label="pitch min" type="number" step="0.005" value={cfg.pitch.min}
            onChange={(e) => set("pitch", { ...cfg.pitch, min: num(e.target.value, cfg.pitch.min) })} /></Field>
          <Field label="Pitch max"><input aria-label="pitch max" type="number" step="0.005" value={cfg.pitch.max}
            onChange={(e) => set("pitch", { ...cfg.pitch, max: num(e.target.value, cfg.pitch.max) })} /></Field>
          <Field label="Pitch steps"><input aria-label="pitch steps" type="number" step="1" value={cfg.pitch.steps}
            onChange={(e) => set("pitch", { ...cfg.pitch, steps: num(e.target.value, cfg.pitch.steps) })} /></Field>
        </div>
        <p className="mt-1 font-mono text-[10px] text-[color:var(--color-ink-muted)]">CW: {xs}</p>
        <p className="font-mono text-[10px] text-[color:var(--color-ink-muted)]">Pitch: {ys}</p>
      </Section>

      <Section title="Circle & layout" dense>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Diameter (mm)"><input aria-label="diameter" type="number" step="0.5" value={cfg.diameterMm}
            onChange={(e) => set("diameterMm", num(e.target.value, cfg.diameterMm))} /></Field>
          <Field label="Gap (mm)"><input aria-label="gap" type="number" step="0.5" value={cfg.gapMm}
            onChange={(e) => set("gapMm", num(e.target.value, cfg.gapMm))} /></Field>
          <Field label="Bed W (mm)"><input aria-label="bed width" type="number" step="10" value={cfg.bedMm.w}
            onChange={(e) => set("bedMm", { ...cfg.bedMm, w: num(e.target.value, cfg.bedMm.w) })} /></Field>
          <Field label="Bed H (mm)"><input aria-label="bed height" type="number" step="10" value={cfg.bedMm.h}
            onChange={(e) => set("bedMm", { ...cfg.bedMm, h: num(e.target.value, cfg.bedMm.h) })} /></Field>
          <Field label="Label size (mm)"><input aria-label="label size" type="number" step="0.5" value={cfg.label.sizeMm}
            onChange={(e) => set("label", { ...cfg.label, sizeMm: num(e.target.value, cfg.label.sizeMm) })} /></Field>
          <label className="flex items-center gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
            <input type="checkbox" checked={cfg.label.show}
              onChange={(e) => set("label", { ...cfg.label, show: e.target.checked })} /> Labels
          </label>
        </div>
        <p className="mt-1 font-mono text-[11px]" style={{ color: overBed ? "var(--color-primary)" : "var(--color-ink)" }}>
          Footprint: {footprint.w.toFixed(0)} × {footprint.h.toFixed(0)} mm{overBed ? " — exceeds bed" : ""}
        </p>
      </Section>
    </div>
  );
}
