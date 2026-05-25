// web/src/components/forge/ForgeControls.tsx
import { Card, CardHeader, CardTitle, Field, NumberField, Select } from "../../ui";
import type { DeepenGroup, ForgeConfig, GeneratedClass, SideMode } from "../../lib/forge/types";

const CLASSES: GeneratedClass[] = ["seed", "perforate", "deepen", "clean"];

export interface ForgeControlsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
  visible: Record<GeneratedClass, boolean>;
  onToggleVisible: (c: GeneratedClass) => void;
}

export function ForgeControls({ config, onChange, visible, onToggleVisible }: ForgeControlsProps) {
  // helper to patch nested config immutably
  const patch = (p: Partial<ForgeConfig>) => onChange({ ...config, ...p });

  const setGroup = (i: number, g: Partial<DeepenGroup>) => {
    const groups = config.deepen.groups.map((row, idx) => (idx === i ? { ...row, ...g } : row));
    patch({ deepen: { ...config.deepen, groups } });
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <Card>
        <CardHeader><CardTitle>Global</CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
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
        </div>
      </Card>

      {/* Stage visibility toggles */}
      <Card>
        <CardHeader><CardTitle>Preview layers</CardTitle></CardHeader>
        <div className="flex flex-wrap gap-2 p-2">
          {CLASSES.map((c) => (
            <label key={c} className="flex items-center gap-1 font-mono uppercase">
              <input type="checkbox" checked={visible[c]} onChange={() => onToggleVisible(c)} />
              {c}
            </label>
          ))}
        </div>
      </Card>

      {/* Seed */}
      <Card>
        <CardHeader><CardTitle>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.seed.enabled}
              onChange={(e) => patch({ seed: { ...config.seed, enabled: e.target.checked } })} />
            Seed (CUT_01)
          </label>
        </CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
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
      </Card>

      {/* Perforate */}
      <Card>
        <CardHeader><CardTitle>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.perforate.enabled}
              onChange={(e) => patch({ perforate: { ...config.perforate, enabled: e.target.checked } })} />
            Perforate (CUT_02)
          </label>
        </CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
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
        </div>
      </Card>

      {/* Deepen pass-group table */}
      <Card>
        <CardHeader><CardTitle>Deepen pass groups (CUT_03–06)</CardTitle></CardHeader>
        <div className="p-2 overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead>
              <tr className="text-left text-[var(--color-muted)]">
                <th>on</th><th>name</th><th>from</th><th>to</th><th>×beam</th>
              </tr>
            </thead>
            <tbody>
              {config.deepen.groups.map((g, i) => (
                <tr key={g.name}>
                  <td><input type="checkbox" checked={g.enabled} onChange={(e) => setGroup(i, { enabled: e.target.checked })} /></td>
                  <td><input className="w-40 bg-transparent border-b" value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} /></td>
                  <td><input className="w-12 bg-transparent border-b" type="number" value={g.fromLayer} onChange={(e) => setGroup(i, { fromLayer: Number(e.target.value) })} /></td>
                  <td><input className="w-12 bg-transparent border-b" type="number" value={g.toLayer} onChange={(e) => setGroup(i, { toLayer: Number(e.target.value) })} /></td>
                  <td><input className="w-12 bg-transparent border-b" type="number" value={g.widthMultiplier} onChange={(e) => setGroup(i, { widthMultiplier: Number(e.target.value) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={config.deepen.outsideOnly} onChange={(e) => patch({ deepen: { ...config.deepen, outsideOnly: e.target.checked } })} /> Outside-only</label>
          </div>
        </div>
      </Card>

      {/* Clean */}
      <Card>
        <CardHeader><CardTitle>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={config.clean.enabled}
              onChange={(e) => patch({ clean: { ...config.clean, enabled: e.target.checked } })} />
            Clean (CUT_07)
          </label>
        </CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
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
        </div>
      </Card>
    </div>
  );
}
