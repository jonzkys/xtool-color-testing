// web/src/components/forge/SpiralControls.tsx
//
// The Spiral page's right rail — "Cut geometry" (the shape of the spiral
// channel). Laser params, passes, and focus descent live in the page's docked
// stage-params tray; beam width / mm-unit override don't affect the spiral cut so
// they're omitted here (they live on the Forge/incise page).
import { Card, CardHeader, CardTitle, Field, NumberField, Select } from "../../ui";
import type { ForgeConfig, MaterialThicknessMm, SpiralConfig } from "../../lib/forge/types";
import { defaultSpiralFor } from "../../lib/forge/presets";
import { SpiralGeometryHelp } from "./SpiralGeometryHelp";

export interface SpiralControlsProps {
  config: ForgeConfig;
  onChange: (next: ForgeConfig) => void;
  /** Active brass thickness — the reset button restores THIS thickness's
   *  geometry defaults (they differ per brass). */
  thicknessMm: MaterialThicknessMm;
}

export function SpiralControls({ config, onChange, thicknessMm }: SpiralControlsProps) {
  const patch = (p: Partial<ForgeConfig>) => onChange({ ...config, ...p, activePreset: "custom" });
  const patchSpiral = (p: Partial<SpiralConfig>) => patch({ spiral: { ...config.spiral, ...p } });

  // The geometry fields the reset button restores — to THIS thickness's defaults.
  const d = defaultSpiralFor(thicknessMm);
  const GEO_DEFAULTS: Pick<SpiralConfig, "channelWidthMm" | "pitchMm" | "minChannelMm" | "side"> = {
    channelWidthMm: d.channelWidthMm,
    pitchMm: d.pitchMm,
    minChannelMm: d.minChannelMm,
    side: d.side,
  };

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
          <Field label="Split internal detail">
            <Select
              value={config.spiral.splitNecks ? "on" : "off"}
              onChange={(e) => patchSpiral({ splitNecks: e.target.value === "on" })}
            >
              <option value="off">off</option>
              <option value="on">on</option>
            </Select>
          </Field>
          {config.spiral.splitNecks && (
            <>
              <Field label="Neck threshold (% width)">
                <NumberField
                  value={config.spiral.neckThresholdPct ?? 50}
                  step={5}
                  min={5}
                  max={100}
                  onChange={(v) => patchSpiral({ neckThresholdPct: Math.min(100, Math.max(5, v)) })}
                />
              </Field>
              <Field label="Split overlap (mm)">
                <NumberField
                  value={config.spiral.neckOverlapMm ?? config.spiral.channelWidthMm}
                  step={0.05}
                  min={0}
                  onChange={(v) => patchSpiral({ neckOverlapMm: v >= 0 ? v : 0 })}
                />
              </Field>
            </>
          )}
          <Field
            label="Cut shortest first"
            help={
              config.spiral.joinStrands
                ? "Disabled while Join strands is on (one object can't be re-ordered)."
                : "Small paths first — vent + relieve the long passes (sets user-defined path order on export)."
            }
          >
            <Select
              value={config.spiral.joinStrands ? "off" : config.spiral.cutShortestFirst ? "on" : "off"}
              disabled={config.spiral.joinStrands}
              onChange={(e) => patchSpiral({ cutShortestFirst: e.target.value === "on" })}
            >
              <option value="on">on</option>
              <option value="off">off</option>
            </Select>
          </Field>
        </div>
      </Card>
    </div>
  );
}
