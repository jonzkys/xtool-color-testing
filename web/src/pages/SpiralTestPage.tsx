import { useMemo, useState } from "react";
import { Button, Card, Field, Input, PageContainer, Section, Select } from "../ui";
import { SpiralTestControls } from "../components/spiraltest/SpiralTestControls";
import { SpiralTestPreview } from "../components/spiraltest/SpiralTestPreview";
import { FixedParams } from "../components/spiraltest/FixedParams";
import { buildSpiralTest, type SpiralTestConfig } from "../lib/forge/spiralTest";
import { buildSpiralTestXs } from "../lib/forge/spiralTestXs";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../lib/forge/spiralParams";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useValidationProfile } from "../state/machine";
import { estimateSpiralTestSeconds } from "../lib/forge/spiralTestTime";
import { fmtDuration } from "../lib/cuttime/model";

const DEFAULT_CFG: SpiralTestConfig = {
  xParam: "channelWidth", yParam: "pitch",
  xAxis: { ...PARAMS.channelWidth.defaultAxis }, yAxis: { ...PARAMS.pitch.defaultAxis },
  fixed: Object.fromEntries(PARAM_ORDER.map((k) => [k, PARAMS[k].defaultFixed])) as Record<ParamKey, number>,
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4, bedMm: { w: 300, h: 300 },
  focusInitialMm: 0.01, laser: "red",
  labels: { show: true, titlePrefix: "" },
  // Label engrave — MOPA IR fill-engrave preset.
  score: { laser: "red", power: 65, speed: 1944, passes: 1, linesPerCm: 300, scanMode: "bidirectional", pulseWidth: 500, frequency: 65 },
};

/** Parse a numeric field, keeping the prior value on empty/NaN — and NOT
 *  clobbering a valid 0 (which `parseFloat(v) || fallback` would). */
function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function SpiralTestPage() {
  const [cfg, setCfg] = useState<SpiralTestConfig>(DEFAULT_CFG);
  // Machine limits for the cut op (F2 Ultra MOPA-IR fiber spiral cut). Null
  // while the registry loads → app-default clamps; usually already cached.
  const profile = useValidationProfile("F2Ultra", "cut");
  // Inputs stay instant (they read `cfg`); only the expensive build + preview
  // run off a debounced copy, so a flurry of keystrokes can't lag the page or
  // briefly explode a too-dense spiral mid-edit.
  const debouncedCfg = useDebouncedValue(cfg, 400);
  const result = useMemo(() => buildSpiralTest(debouncedCfg, profile), [debouncedCfg, profile]);
  // Ballpark job time (cut + label engrave); tracks the debounced preview.
  const estSeconds = useMemo(() => estimateSpiralTestSeconds(result, debouncedCfg).totalSeconds, [result, debouncedCfg]);

  const onExport = () => {
    // Build fresh from the live cfg so the export always reflects the latest
    // form values even if the debounced preview hasn't caught up yet.
    const buf = buildSpiralTestXs(buildSpiralTest(cfg, profile), cfg);
    const url = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = "spiral-test.xs"; a.click();
    URL.revokeObjectURL(url);
  };

  const setScore = <K extends keyof SpiralTestConfig["score"]>(k: K, v: SpiralTestConfig["score"][K]) =>
    setCfg({ ...cfg, score: { ...cfg.score, [k]: v } });

  return (
    <div className="relative flex flex-col" style={{ height: "calc(100dvh - 56px)" }}>
      <PageContainer maxWidth="wide" className="relative flex min-h-0 flex-1 flex-col overflow-hidden pt-3 pb-3">
        <div className="flex shrink-0 items-baseline gap-3 pb-1">
          <h1 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-subtle)]">
            Spiral Test
          </h1>
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[color:var(--color-ink-subtle)]/70">
            parameter sweep
          </span>
          <span className="ml-auto font-mono text-[11px] tabular-nums"
            style={{ color: result.overBed ? "var(--color-primary)" : "var(--color-ink-muted)" }}>
            {result.cells.length} cells · {result.footprintMm.w.toFixed(0)}×{result.footprintMm.h.toFixed(0)} mm
            {" "}· ~{fmtDuration(estSeconds)}
            {result.overBed ? " · exceeds bed" : ""}
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_248px] grid-rows-[minmax(0,1fr)] items-stretch gap-3 pt-3">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 [&>*]:shrink-0">
            <SpiralTestControls cfg={cfg} onChange={setCfg} footprint={result.footprintMm} overBed={result.overBed} profile={profile} />
          </div>

          <Card padded={false} className="flex min-h-0 min-w-0 p-3">
            <SpiralTestPreview result={result} />
          </Card>

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-1 [&>*]:shrink-0">
            <FixedParams cfg={cfg} onChange={setCfg} profile={profile} />

            <Section title="Label engrave" dense>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Laser" className="col-span-2">
                  <Select aria-label="label laser" value={cfg.score.laser}
                    onChange={(e) => setScore("laser", e.target.value as SpiralTestConfig["score"]["laser"])}>
                    <option value="red">MOPA IR</option>
                    <option value="blue">Blue</option>
                    <option value="uv">UV</option>
                  </Select>
                </Field>
                <Field label="Power (%)">
                  <Input aria-label="label power" type="number" mono value={cfg.score.power}
                    onChange={(e) => setScore("power", num(e.target.value, cfg.score.power))} />
                </Field>
                <Field label="Speed (mm/s)">
                  <Input aria-label="label speed" type="number" mono value={cfg.score.speed}
                    onChange={(e) => setScore("speed", num(e.target.value, cfg.score.speed))} />
                </Field>
                <Field label="Pass">
                  <Input aria-label="label pass" type="number" mono value={cfg.score.passes}
                    onChange={(e) => setScore("passes", Math.max(1, Math.round(num(e.target.value, cfg.score.passes))))} />
                </Field>
                <Field label="Lines per cm">
                  <Input aria-label="label lines per cm" type="number" mono value={cfg.score.linesPerCm}
                    onChange={(e) => setScore("linesPerCm", num(e.target.value, cfg.score.linesPerCm))} />
                </Field>
                <Field label="Engraving mode" className="col-span-2">
                  <Select aria-label="label engraving mode" value={cfg.score.scanMode}
                    onChange={(e) => setScore("scanMode", e.target.value as SpiralTestConfig["score"]["scanMode"])}>
                    <option value="bidirectional">Bi-directional</option>
                    <option value="unidirectional">Uni-directional</option>
                  </Select>
                </Field>
                <Field label="Pulse width (ns)">
                  <Input aria-label="label pulse width" type="number" mono value={cfg.score.pulseWidth}
                    onChange={(e) => setScore("pulseWidth", num(e.target.value, cfg.score.pulseWidth))} />
                </Field>
                <Field label="Frequency (kHz)">
                  <Input aria-label="label frequency" type="number" mono value={cfg.score.frequency}
                    onChange={(e) => setScore("frequency", num(e.target.value, cfg.score.frequency))} />
                </Field>
              </div>
              <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[color:var(--color-ink-subtle)]">
                Real-font fill engrave (title + axis values).
              </p>
            </Section>

            <Section title="Export" dense>
              <Button variant="primary" size="sm" className="w-full" onClick={onExport}>
                Export .xs
              </Button>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-[color:var(--color-ink-subtle)]">
                One .xs: spiral cuts + engraved labels as two operations.
              </p>
            </Section>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
