// web/src/components/forge/SpiralGeometryPanel.tsx
// Path-geometry panel (left rail): the controls that shape how the outline turns
// into cut objects (Simplify, per-path cap, Join strands) PLUS a live readout of
// the result BEFORE export — cut objects, paths, points, mm/unit.
import { Card, CardHeader, CardTitle, Field, NumberField, Select } from "../../ui";
import type { DebugStats, ForgeConfig, SpiralConfig } from "../../lib/forge/types";

function Row({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{label}</span>
      <span
        className={
          "font-mono text-[12px] tabular-nums " +
          (tone === "warn"
            ? "text-[color:var(--color-destructive)]"
            : tone === "ok"
            ? "text-[var(--color-primary)]"
            : "text-[var(--color-ink)]")
        }
      >
        {value}
      </span>
    </div>
  );
}

export function SpiralGeometryPanel({
  config,
  onChange,
  stats,
}: {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
  stats: DebugStats | null;
}) {
  const sp = config.spiral;
  const patchSpiral = (p: Partial<SpiralConfig>) =>
    onChange({ ...config, spiral: { ...config.spiral, ...p }, activePreset: "custom" });

  const objs = stats?.spiralExportObjects ?? 0;
  const strands = stats?.pathCounts.spiral ?? 0;
  const status = objs <= 1 ? "continuous" : objs > strands ? "cap-split" : "multi-path";
  const joinOverflow = sp.joinStrands && objs > 1; // wanted to join but didn't fit the cap

  return (
    <Card>
      <CardHeader>
        <CardTitle>Path geometry</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-2 p-2">
        <Field label="Simplify (mm)" hint="Round the outline first; 0 = off.">
          <NumberField value={sp.simplifyEpsMm} step={0.01} min={0} onChange={(v) => patchSpiral({ simplifyEpsMm: Math.max(0, v) })} />
        </Field>
        <Field label="Max points / path" hint="Split above this; raise for one cut.">
          <NumberField value={sp.maxPathPoints} step={500} min={100} onChange={(v) => patchSpiral({ maxPathPoints: Math.max(100, Math.round(v)) })} />
        </Field>
        <Field label="Join strands" hint="Merge strands into one cut.">
          <Select value={sp.joinStrands ? "on" : "off"} onChange={(e) => patchSpiral({ joinStrands: e.target.value === "on" })}>
            <option value="on">on</option>
            <option value="off">off</option>
          </Select>
        </Field>
      </div>
      {stats && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--color-border)] p-2">
          <Row label="Cut objects" value={`${objs} · ${status}`} tone={objs <= 1 ? "ok" : "warn"} />
          <Row label="Spiral paths" value={strands} />
          <Row label="Points" value={stats.spiralPoints.toLocaleString()} />
          <Row label="mm / unit" value={`${stats.mmPerUnit.toFixed(4)}${stats.mmPerUnitConfident ? " ✓" : " ⚠"}`} />
          {joinOverflow && (
            <span className="font-mono text-[10px] text-[color:var(--color-destructive)]">
              {stats.spiralPoints.toLocaleString()} pts &gt; cap — raise Max points to merge into one cut.
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
