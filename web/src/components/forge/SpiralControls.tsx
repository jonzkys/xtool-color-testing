// web/src/components/forge/SpiralControls.tsx
//
// The Spiral page's right rail — "Cut geometry" (the shape of the spiral
// channel) plus a collapsed Setup disclosure. Laser params, passes, and focus
// descent live in the page's docked stage-params tray, NOT here, so each value
// has exactly one widget.
import { Card, CardHeader, CardTitle, Field, NumberField, Select } from "../../ui";
import type { ForgeConfig, SpiralConfig } from "../../lib/forge/types";
import { SPIRAL_CUT } from "../../lib/forge/presets";
import { SpiralGeometryHelp } from "./SpiralGeometryHelp";

export interface SpiralControlsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
}

const SUMMARY_CLS =
  "cursor-pointer select-none list-none font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors px-1 py-0.5";

// The geometry fields the reset button restores to their Spiral-preset defaults.
const GEO_DEFAULTS: Pick<SpiralConfig, "channelWidthMm" | "pitchMm" | "minChannelMm" | "side"> = {
  channelWidthMm: SPIRAL_CUT.spiral.channelWidthMm,
  pitchMm: SPIRAL_CUT.spiral.pitchMm,
  minChannelMm: SPIRAL_CUT.spiral.minChannelMm,
  side: SPIRAL_CUT.spiral.side,
};

export function SpiralControls({ config, onChange }: SpiralControlsProps) {
  const patch = (p: Partial<ForgeConfig>) => onChange({ ...config, ...p, activePreset: "custom" });
  const patchSpiral = (p: Partial<SpiralConfig>) => patch({ spiral: { ...config.spiral, ...p } });

  const geoChanged =
    config.spiral.channelWidthMm !== GEO_DEFAULTS.channelWidthMm ||
    config.spiral.pitchMm !== GEO_DEFAULTS.pitchMm ||
    config.spiral.minChannelMm !== GEO_DEFAULTS.minChannelMm ||
    config.spiral.side !== GEO_DEFAULTS.side;

  return (
    <div className="flex flex-col gap-2 text-xs">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => patchSpiral(GEO_DEFAULTS)}
              disabled={!geoChanged}
              title="Reset cut geometry to defaults"
              aria-label="Reset cut geometry to defaults"
              className="shrink-0 grid h-5 w-5 place-items-center rounded-[5px] border border-[var(--color-border)] text-[var(--color-ink-muted)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)]/50 disabled:opacity-40 disabled:hover:text-[var(--color-ink-muted)] disabled:hover:border-[var(--color-border)] transition-colors"
            >
              <span aria-hidden className="text-[11px] leading-none">↺</span>
            </button>
            <CardTitle>Cut geometry</CardTitle>
            <SpiralGeometryHelp />
          </div>
        </CardHeader>
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
