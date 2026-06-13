// web/src/components/forge/SpiralControls.tsx
//
// The Spiral page's right rail — "Cut geometry" (the shape of the spiral
// channel) plus a collapsed Setup disclosure. Laser params, passes, and focus
// descent live in the page's docked stage-params tray, NOT here, so each value
// has exactly one widget.
import { Card, CardHeader, CardTitle, Field, NumberField, Select } from "../../ui";
import type { ForgeConfig, SpiralConfig } from "../../lib/forge/types";

export interface SpiralControlsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
}

const SUMMARY_CLS =
  "cursor-pointer select-none list-none font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors px-1 py-0.5";

export function SpiralControls({ config, onChange }: SpiralControlsProps) {
  const patch = (p: Partial<ForgeConfig>) => onChange({ ...config, ...p, activePreset: "custom" });
  const patchSpiral = (p: Partial<SpiralConfig>) => patch({ spiral: { ...config.spiral, ...p } });

  return (
    <div className="flex flex-col gap-2 text-xs">
      <Card>
        <CardHeader><CardTitle>Cut geometry</CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
          <Field label="Channel width (mm)">
            <NumberField value={config.spiral.channelWidthMm} step={0.05} min={0.05}
              onChange={(v) => patchSpiral({ channelWidthMm: v })} />
          </Field>
          <Field label="Pitch (mm)">
            <NumberField value={config.spiral.pitchMm} step={0.01} min={0.005}
              onChange={(v) => patchSpiral({ pitchMm: v })} />
          </Field>
          <Field label="Min channel (mm)">
            <NumberField value={config.spiral.minChannelMm} step={0.05} min={0.05}
              onChange={(v) => patchSpiral({ minChannelMm: v })} />
          </Field>
          <Field label="Side">
            <Select value={config.spiral.side}
              onChange={(e) => patchSpiral({ side: e.target.value as "outside" | "inside" })}>
              <option value="outside">outside</option>
              <option value="inside">inside</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card padded={false} className="p-2">
        <details>
          <summary className={SUMMARY_CLS}>Setup &amp; calibration</summary>
          <div className="grid grid-cols-2 gap-2 p-1 pt-2">
            <Field label="Beam width (mm)">
              <NumberField value={config.beamWidthMm} step={0.01} min={0.005}
                onChange={(v) => patch({ beamWidthMm: v })} />
            </Field>
            <Field label="mm / unit override (blank = auto)">
              <NumberField value={config.mmPerUnitOverride ?? 0} step={0.0001} min={0}
                onChange={(v) => patch({ mmPerUnitOverride: v > 0 ? v : null })} />
            </Field>
          </div>
        </details>
      </Card>
    </div>
  );
}
