import { useMemo, useState } from "react";
import { Button, Card, Field, PageContainer, Section } from "../ui";
import { SpiralTestControls } from "../components/spiraltest/SpiralTestControls";
import { SpiralTestPreview } from "../components/spiraltest/SpiralTestPreview";
import { buildSpiralTest, type SpiralTestConfig } from "../lib/forge/spiralTest";
import { buildSpiralTestXs } from "../lib/forge/spiralTestXs";

const DEFAULT_CFG: SpiralTestConfig = {
  channelWidth: { min: 0.6, max: 1.0, steps: 4 },
  pitch: { min: 0.03, max: 0.05, steps: 4 },
  diameterMm: 10, side: "outside", minChannelMm: 0.4, gapMm: 4,
  bedMm: { w: 300, h: 300 }, label: { sizeMm: 2.5, show: true },
  cut: { passes: 250, focusInitialMm: 0.01, focusStepMm: 0.06, focusIntervalPasses: 20,
         power: 100, speed: 1500, frequency: 65, pulseWidth: 80, laser: "red" },
  score: { power: 8, speed: 300, passes: 1 },
};

/** Parse a numeric field, keeping the previous value on empty/NaN — and crucially
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

  return (
    <PageContainer>
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_280px] items-stretch gap-4">
        <div className="overflow-y-auto pr-1">
          <SpiralTestControls cfg={cfg} onChange={setCfg} footprint={result.footprintMm} overBed={result.overBed} />
        </div>
        <Card padded={false} className="flex min-h-0 flex-1 p-3">
          <SpiralTestPreview result={result} />
        </Card>
        <div className="flex flex-col gap-4 overflow-y-auto pl-1">
          <Section title="Cut params" dense>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Passes"><input aria-label="passes" type="number" value={cfg.cut.passes}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, passes: num(e.target.value, cfg.cut.passes) } })} /></Field>
              <Field label="Power"><input aria-label="power" type="number" value={cfg.cut.power}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, power: num(e.target.value, cfg.cut.power) } })} /></Field>
              <Field label="Speed"><input aria-label="speed" type="number" value={cfg.cut.speed}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, speed: num(e.target.value, cfg.cut.speed) } })} /></Field>
              <Field label="Focus step"><input aria-label="focus step" type="number" step="0.01" value={cfg.cut.focusStepMm}
                onChange={(e) => setCfg({ ...cfg, cut: { ...cfg.cut, focusStepMm: num(e.target.value, cfg.cut.focusStepMm) } })} /></Field>
            </div>
          </Section>
          <Section title="Export" dense>
            <Button variant="primary" size="sm" className="w-full" onClick={onExport}>Export .xs</Button>
          </Section>
        </div>
      </div>
    </PageContainer>
  );
}
