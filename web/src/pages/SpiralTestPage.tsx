import { useMemo, useState } from "react";
import { Button, Card, Field, Input, PageContainer, Section } from "../ui";
import { SpiralTestControls } from "../components/spiraltest/SpiralTestControls";
import { SpiralTestPreview } from "../components/spiraltest/SpiralTestPreview";
import { buildSpiralTest, type SpiralTestConfig } from "../lib/forge/spiralTest";
import { buildSpiralTestXs } from "../lib/forge/spiralTestXs";
import { descentDepthMm } from "../lib/forge/depth";

const DEFAULT_CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 4 },
  pitch: { min: 0.03, max: 0.05, steps: 4 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, label: { sizeMm: 2.5, show: true },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { power: 8, speed: 300, passes: 1 },
};

/** Parse a numeric field, keeping the prior value on empty/NaN — and crucially
 *  NOT clobbering a valid 0 (which `parseFloat(v) || fallback` would). */
function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function SpiralTestPage() {
  const [cfg, setCfg] = useState<SpiralTestConfig>(DEFAULT_CFG);
  const result = useMemo(() => buildSpiralTest(cfg), [cfg]);

  const onExport = () => {
    const buf = buildSpiralTestXs(result, cfg);
    const url = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = "spiral-test.xs"; a.click();
    URL.revokeObjectURL(url);
  };

  const setCut = <K extends keyof SpiralTestConfig["cut"]>(k: K, v: SpiralTestConfig["cut"][K]) =>
    setCfg({ ...cfg, cut: { ...cfg.cut, [k]: v } });

  return (
    <div className="relative flex flex-col" style={{ height: "calc(100dvh - 56px)" }}>
      <PageContainer maxWidth="wide" className="relative flex min-h-0 flex-1 flex-col overflow-hidden pt-3 pb-3">
        {/* Header band — gives the page breathing room under the top bar and a
            live status (cell count + footprint, ember when it exceeds the bed). */}
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
            {result.overBed ? " · exceeds bed" : ""}
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[272px_minmax(0,1fr)_248px] grid-rows-[minmax(0,1fr)] items-stretch gap-3 pt-3">
          {/* Left rail — grid + layout config */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 [&>*]:shrink-0">
            <SpiralTestControls cfg={cfg} onChange={setCfg} footprint={result.footprintMm} overBed={result.overBed} />
          </div>

          {/* Centre — live preview */}
          <Card padded={false} className="flex min-h-0 min-w-0 p-3">
            <SpiralTestPreview result={result} />
          </Card>

          {/* Right rail — cut params + export */}
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-1 [&>*]:shrink-0">
            <Section title="Cut params" dense>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Passes">
                  <Input aria-label="passes" type="number" mono value={cfg.cut.passes}
                    onChange={(e) => setCut("passes", num(e.target.value, cfg.cut.passes))} />
                </Field>
                <Field label="Power">
                  <Input aria-label="power" type="number" mono value={cfg.cut.power}
                    onChange={(e) => setCut("power", num(e.target.value, cfg.cut.power))} />
                </Field>
                <Field label="Speed">
                  <Input aria-label="speed" type="number" mono value={cfg.cut.speed}
                    onChange={(e) => setCut("speed", num(e.target.value, cfg.cut.speed))} />
                </Field>
              </div>

              {/* Focus descent — the cut's Z mechanism, matching the Spiral page:
                  the focus walks down through the material as the spiral repeats. */}
              <div className="mt-3 rounded border border-[color:var(--color-border)] p-2">
                <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
                  Focus descent
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Initial (mm)">
                    <Input aria-label="focus initial" type="number" mono step={0.01} value={cfg.cut.focusInitialMm}
                      onChange={(e) => setCut("focusInitialMm", Math.max(0, num(e.target.value, cfg.cut.focusInitialMm)))} />
                  </Field>
                  <Field label="Per step (mm)">
                    <Input aria-label="focus step" type="number" mono step={0.01} value={cfg.cut.focusStepMm}
                      onChange={(e) => setCut("focusStepMm", Math.max(0, num(e.target.value, cfg.cut.focusStepMm)))} />
                  </Field>
                  <Field label="Every N passes">
                    <Input aria-label="focus interval passes" type="number" mono step={1} value={cfg.cut.focusIntervalPasses}
                      onChange={(e) => setCut("focusIntervalPasses", Math.max(1, Math.round(num(e.target.value, cfg.cut.focusIntervalPasses))))} />
                  </Field>
                  <div className="flex flex-col justify-end pb-0.5">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
                      Descent @ {cfg.cut.passes}p
                    </span>
                    <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
                      {descentDepthMm(cfg.cut.passes, cfg.cut.focusIntervalPasses, cfg.cut.focusStepMm).toFixed(3)} mm
                    </span>
                  </div>
                </div>
              </div>
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
