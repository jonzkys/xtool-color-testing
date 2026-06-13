// web/src/components/forge/ForgeControls.tsx
import { useState, type ReactNode } from "react";
import { Card, Field, NumberField, Select, cn } from "../../ui";
import type { DeepenGroup, ForgeConfig, GeneratedClass, SideMode } from "../../lib/forge/types";
import { renameDeepenGroup } from "../../lib/forge/config";
import { PRESETS, type PresetId } from "../../lib/forge/presets";

export interface ForgeControlsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
  visible: Record<GeneratedClass, boolean>;
  onToggleVisible: (c: GeneratedClass) => void;
}

/** One collapsible rail section: workshop-register header (optional enable
 *  checkbox, kept OUTSIDE the toggle button so ticking it never collapses the
 *  section), muted summary, chevron. All sections start collapsed — the rail
 *  reads as a table of contents until you open the stage you're working on. */
function RailSection({
  title,
  check,
  summary,
  children,
}: {
  title: string;
  check?: { checked: boolean; onChange: (v: boolean) => void };
  summary?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="flex items-stretch">
        {check && (
          <label className="flex items-center pl-3 pr-1 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={check.checked}
              onChange={(e) => check.onChange(e.target.checked)}
            />
          </label>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "flex-1 flex items-center gap-2 py-2 pr-3 text-left min-w-0",
            check ? "pl-2" : "pl-3",
            "font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em]",
            "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors",
          )}
        >
          <span className="truncate">{title}</span>
          {summary && (
            <span className="ml-auto shrink-0 font-normal normal-case tracking-normal text-[10px] text-[var(--color-ink-subtle)]">
              {summary}
            </span>
          )}
          <span
            aria-hidden
            className={cn(
              "shrink-0 text-[var(--color-ink-subtle)] transition-transform",
              !summary && "ml-auto",
              open && "rotate-90",
            )}
          >
            ▸
          </span>
        </button>
      </div>
      {open && <div className="border-t border-[var(--color-border)] p-3">{children}</div>}
    </Card>
  );
}

export function ForgeControls({ config, onChange }: ForgeControlsProps) {
  // helper to patch nested config immutably — marks manual edits as "custom"
  const patch = (p: Partial<ForgeConfig>) =>
    onChange({ ...config, ...p, activePreset: "custom" });

  const setGroup = (i: number, g: Partial<DeepenGroup>) => {
    const groups = config.deepen.groups.map((row, idx) => (idx === i ? { ...row, ...g } : row));
    patch({ deepen: { ...config.deepen, groups } });
  };

  const presetLabel =
    config.activePreset === "lean" ? "Lean" :
    config.activePreset === "aggressive" ? "Aggressive" : "Custom";

  return (
    <div className="flex flex-col gap-2 text-xs">
      {/* Strategy — the page's most consequential controls, first. */}
      <RailSection title="Strategy" summary={presetLabel}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Preset" className="col-span-2">
            <Select
              value={config.activePreset ?? "custom"}
              onChange={(e) => {
                const id = e.target.value as PresetId | "custom";
                if (id === "custom") return;
                onChange(structuredClone(PRESETS[id]));
              }}
            >
              <option value="lean">Lean (fast)</option>
              <option value="aggressive">Aggressive (deep 1/2/4/8)</option>
              <option value="custom" disabled>Custom</option>
            </Select>
          </Field>
          <Field label="Time budget (× incise)">
            <Select
              value={String(config.timeBudgetX ?? "off")}
              onChange={(e) => {
                const v = e.target.value;
                patch({ timeBudgetX: v === "off" ? null : Number(v) });
              }}
            >
              <option value="off">off</option>
              <option value="1.25">1.25×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
              <option value="3">3×</option>
            </Select>
          </Field>
        </div>
      </RailSection>

      {/* Seed */}
      <RailSection
        title="Seed (CUT_01)"
        check={{
          checked: config.seed.enabled,
          onChange: (v) => patch({ seed: { ...config.seed, enabled: v } }),
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width × beam">
            <NumberField value={config.seed.widthMultiplier} step={1} min={1}
              onChange={(v) => patch({ seed: { ...config.seed, widthMultiplier: v } })} />
          </Field>
          <Field label="Layers (≤5)">
            <NumberField value={config.seed.layerCount} step={1} min={1} max={5}
              onChange={(v) => patch({ seed: { ...config.seed, layerCount: Math.min(5, v) } })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={config.seed.outsideOnly}
              onChange={(e) => patch({ seed: { ...config.seed, outsideOnly: e.target.checked } })} />
            Outside-only
          </label>
        </div>
      </RailSection>

      {/* Perforate */}
      <RailSection
        title="Perforate / Relief (CUT_02)"
        check={{
          checked: config.perforate.enabled,
          onChange: (v) => patch({ perforate: { ...config.perforate, enabled: v } }),
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Spacing (mm)">
            <NumberField value={config.perforate.spacingMm} step={0.5} min={0.25}
              onChange={(v) => patch({ perforate: { ...config.perforate, spacingMm: v } })} />
          </Field>
          <Field label="Pocket size (mm)">
            <NumberField value={config.perforate.pocketSizeMm} step={0.05} min={0.05}
              onChange={(v) => patch({ perforate: { ...config.perforate, pocketSizeMm: v } })} />
          </Field>
          <Field label="Corner angle (°)">
            <NumberField value={config.perforate.cornerAngleThresholdDeg} step={5} min={5} max={170}
              onChange={(v) => patch({ perforate: { ...config.perforate, cornerAngleThresholdDeg: v } })} />
          </Field>
          <Field label="Layers">
            <NumberField value={config.perforate.layerCount} step={1} min={1}
              onChange={(v) => patch({ perforate: { ...config.perforate, layerCount: Math.max(1, v) } })} />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.perforate.cornerBoost}
              onChange={(e) => patch({ perforate: { ...config.perforate, cornerBoost: e.target.checked } })} />
            Corner boost
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.perforate.outsideBias}
              onChange={(e) => patch({ perforate: { ...config.perforate, outsideBias: e.target.checked } })} />
            Outside bias
          </label>
          <Field label="Shape">
            <Select value={config.perforate.shape}
              onChange={(e) => patch({ perforate: { ...config.perforate, shape: e.target.value as "pocket" | "slot" } })}>
              <option value="pocket">pocket</option>
              <option value="slot">slot</option>
            </Select>
          </Field>
          <Field label="Gap threshold (mm)">
            <NumberField value={config.perforate.gapThresholdMm} step={0.25} min={0.25}
              onChange={(v) => patch({ perforate: { ...config.perforate, gapThresholdMm: v } })} />
          </Field>
          {config.perforate.shape === "slot" && (
            <Field label="Slot length (mm)">
              <NumberField value={config.perforate.slotLengthMm} step={0.1} min={0.1}
                onChange={(v) => patch({ perforate: { ...config.perforate, slotLengthMm: v } })} />
            </Field>
          )}
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={config.perforate.nearGap}
              onChange={(e) => patch({ perforate: { ...config.perforate, nearGap: e.target.checked } })} />
            Near-gap vents
          </label>
        </div>
      </RailSection>

      {/* Deepen pass-group table */}
      <RailSection
        title="Deepen groups (CUT_03–06)"
        summary={config.deepen.groups.length === 0 ? "none" : `${config.deepen.groups.length}`}
      >
        {config.deepen.groups.length === 0 ? (
          <p className="text-[10px] text-[var(--color-ink-subtle)]">
            No pass groups in this preset — Spiral Cut replaces deepening.
          </p>
        ) : (
          <>
            {/* table-fixed + colgroup: the name column flexes and the numeric
                columns stay fixed, so inputs fill their own cell (w-full) instead
                of overflowing into the next column. */}
            <table className="w-full table-fixed font-mono text-[11px]">
              <colgroup>
                <col className="w-5" />
                <col />
                <col className="w-12" />
                <col className="w-10" />
              </colgroup>
              <thead>
                <tr className="text-left text-[var(--color-muted)]">
                  <th></th><th>name</th><th className="text-right pr-1">cum.</th><th className="text-right">×b</th>
                </tr>
              </thead>
              <tbody>
                {config.deepen.groups.map((g, i) => (
                  // Key by the stable index, NOT the user-editable name: keying by
                  // `g.name` remounts the row on every keystroke (focus loss) and
                  // collides when two groups share a name.
                  <tr key={i}>
                    <td><input type="checkbox" checked={g.enabled} onChange={(e) => setGroup(i, { enabled: e.target.checked })} /></td>
                    <td className="pr-2"><input className="w-full min-w-0 bg-transparent border-b" value={g.name} onChange={(e) => onChange({ ...renameDeepenGroup(config, i, e.target.value), activePreset: "custom" })} /></td>
                    <td className="pr-1"><input className="w-full min-w-0 bg-transparent border-b text-right" type="number" value={g.toLayer} onChange={(e) => setGroup(i, { toLayer: Number(e.target.value) })} /></td>
                    <td><input className="w-full min-w-0 bg-transparent border-b text-right" type="number" value={g.widthMultiplier} onChange={(e) => setGroup(i, { widthMultiplier: Number(e.target.value) })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-[var(--color-ink-subtle)]">
              each group re-engraves from the surface (0) to this depth.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={config.deepen.outsideOnly} onChange={(e) => patch({ deepen: { ...config.deepen, outsideOnly: e.target.checked } })} /> Outside-only</label>
            </div>
          </>
        )}
      </RailSection>

      {/* Clean */}
      <RailSection
        title="Clean (CUT_07)"
        check={{
          checked: config.clean.enabled,
          onChange: (v) => patch({ clean: { ...config.clean, enabled: v } }),
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label="Walls">
            <Select value={config.clean.offsetSelection}
              onChange={(e) => patch({ clean: { ...config.clean, offsetSelection: e.target.value as "walls" | "outer" | "inner" } })}>
              <option value="walls">both walls</option>
              <option value="outer">outer only</option>
              <option value="inner">inner only</option>
            </Select>
          </Field>
          <Field label="Passes">
            <NumberField value={config.clean.passes} step={1} min={1}
              onChange={(v) => patch({ clean: { ...config.clean, passes: v } })} />
          </Field>
          <Field label="Layers">
            <NumberField value={config.clean.layerCount} step={1} min={1}
              onChange={(v) => patch({ clean: { ...config.clean, layerCount: Math.max(1, v) } })} />
          </Field>
        </div>
      </RailSection>

      {/* Setup & calibration — set-once plumbing, last. */}
      <RailSection title="Setup & calibration">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Beam width (mm)">
            <NumberField value={config.beamWidthMm} step={0.01} min={0.005}
              onChange={(v) => patch({ beamWidthMm: v })} />
          </Field>
          <Field label="Offset side">
            <Select value={config.sideMode}
              onChange={(e) => patch({ sideMode: e.target.value as SideMode })}>
              <option value="outside">outside</option>
              <option value="inside">inside</option>
              <option value="symmetric">symmetric</option>
              <option value="flip">flip</option>
            </Select>
          </Field>
          <Field label="mm / unit override (blank = auto)">
            <NumberField value={config.mmPerUnitOverride ?? 0} step={0.0001} min={0}
              onChange={(v) => patch({ mmPerUnitOverride: v > 0 ? v : null })} />
          </Field>
          <Field label="Scan angle (° · 0 = inherit)">
            <NumberField value={config.manualScanAngleDeg ?? 0} step={1} min={0}
              disabled={config.optimizeScanAngle}
              onChange={(v) => patch({ manualScanAngleDeg: v > 0 ? v : null })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={config.optimizeScanAngle}
              onChange={(e) => patch({ optimizeScanAngle: e.target.checked })} />
            Optimize scan angle (experimental)
          </label>
        </div>
      </RailSection>
    </div>
  );
}
