/**
 * Relief — Surface controls.
 *
 * Everything that shapes the height-field itself (independent of the cutout):
 * denoise (smoothing / edge-preserve / speckle), tone stretch, and the
 * preview-only layer hints. Dense ``Section``s with ``?`` tooltips for the
 * long-form hints so the panel stays compact.
 */

import { Section } from "../../ui";
import type { ReliefParams } from "../../pages/reliefHelpers";
import type { StretchMode, StretchParams } from "./stretch";
import { SegmentedChoice, SelectField, Slider, Toggle } from "./fields";

export interface SurfaceControlsProps {
  reliefParams: ReliefParams;
  onReliefChange: (p: ReliefParams) => void;
  stretchParams: StretchParams;
  onStretchChange: (p: StretchParams) => void;
}

const MODE_OPTIONS: { value: StretchMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "linear", label: "Linear" },
  { value: "gamma", label: "Gamma" },
  { value: "asinh", label: "Asinh" },
  { value: "equalize", label: "Equalize" },
  { value: "clahe", label: "CLAHE" },
];

function modeHint(mode: StretchMode): string {
  switch (mode) {
    case "none":
      return "No change — pick a mode to stretch the tones.";
    case "linear":
      return "Pull black/white points to 0–255; relative depth preserved.";
    case "gamma":
      return "Power curve over the trimmed range.";
    case "asinh":
      return "Nonlinear low-end lift (astro screen-stretch).";
    case "equalize":
      return "Global histogram equalization.";
    case "clahe":
      return "Tile-adaptive local contrast — runs on the server.";
  }
}

export function SurfaceControls({
  reliefParams,
  onReliefChange,
  stretchParams,
  onStretchChange,
}: SurfaceControlsProps) {
  const setR = <K extends keyof ReliefParams>(key: K, value: ReliefParams[K]) =>
    onReliefChange({ ...reliefParams, [key]: value });
  const setS = <K extends keyof StretchParams>(key: K, value: StretchParams[K]) =>
    onStretchChange({ ...stretchParams, [key]: value });

  const { mode } = stretchParams;
  const showClipCaveat = mode === "linear" || mode === "gamma" || mode === "asinh";

  return (
    <>
      {/* ── Smoothing ──────────────────────────────────────────────── */}
      <Section title="Smoothing" dense>
        <Toggle
          label="Enable smoothing"
          checked={reliefParams.smoothEnabled}
          onChange={(v) => setR("smoothEnabled", v)}
          hint="Bilateral spatial radius — higher = softer, more aggressive."
        />
        {reliefParams.smoothEnabled && (
          <Slider
            label="Strength"
            value={reliefParams.strength}
            min={1}
            max={30}
            onChange={(v) => setR("strength", v)}
            hint="Radius of the bilateral / median pass."
          />
        )}
      </Section>

      {reliefParams.smoothEnabled && (
        <>
          {/* ── Edge preserve ─────────────────────────────────────────── */}
          <Section title="Edges" dense>
            <Toggle
              label="Preserve edges"
              checked={reliefParams.edgePreserve}
              onChange={(v) => setR("edgePreserve", v)}
              hint="Keep steep real edges crisp while smoothing the flats."
            />
            {reliefParams.edgePreserve && (
              <Slider
                label="Edge threshold"
                value={reliefParams.edgeThreshold}
                min={1}
                max={255}
                onChange={(v) => setR("edgeThreshold", v)}
                hint="Preserve drops steeper than this — keeps real edges crisp."
              />
            )}
          </Section>

          {/* ── Speckle ──────────────────────────────────────────────── */}
          <Section title="Speckle" dense>
            <Toggle
              label="Remove speckle"
              checked={reliefParams.spikeRemoval}
              onChange={(v) => setR("spikeRemoval", v)}
              hint="Median pass that kills pepper noise and single-pixel spikes."
            />
            {reliefParams.spikeRemoval && (
              <SegmentedChoice
                value={reliefParams.medianKsize}
                options={[
                  { value: 3, label: "3 × 3" },
                  { value: 5, label: "5 × 5" },
                ]}
                onChange={(v) => setR("medianKsize", v)}
              />
            )}
          </Section>
        </>
      )}

      {/* ── Stretch ────────────────────────────────────────────────── */}
      <Section title="Stretch" dense>
        <SelectField
          label="Mode"
          ariaLabel="Mode"
          value={mode}
          onChange={(v) => setS("mode", v as StretchMode)}
          options={MODE_OPTIONS}
          hint={modeHint(mode)}
        />

        {mode === "linear" && (
          <>
            <Slider
              label="Clip low %"
              value={stretchParams.clipLowPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => setS("clipLowPct", v)}
              hint="Trim this % of the darkest pixels onto the black point."
            />
            <Slider
              label="Clip high %"
              value={stretchParams.clipHighPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => setS("clipHighPct", v)}
            />
          </>
        )}

        {mode === "gamma" && (
          <>
            <Slider
              label="Clip %"
              value={stretchParams.clipPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => setS("clipPct", v)}
            />
            <Slider
              label="Gamma"
              value={stretchParams.gamma}
              min={0.2}
              max={2.5}
              step={0.05}
              onChange={(v) => setS("gamma", v)}
              hint="< 1 lifts midtones, > 1 deepens them."
            />
          </>
        )}

        {mode === "asinh" && (
          <>
            <Slider
              label="Clip %"
              value={stretchParams.clipPct}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => setS("clipPct", v)}
            />
            <Slider
              label="Strength"
              value={stretchParams.asinhStrength}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setS("asinhStrength", v)}
              hint="Astro-style lift of low / shallow relief."
            />
          </>
        )}

        {mode === "clahe" && (
          <>
            <Slider
              label="Clip limit"
              value={stretchParams.claheClipLimit}
              min={1}
              max={8}
              step={0.5}
              onChange={(v) => setS("claheClipLimit", v)}
              hint="Higher = stronger local contrast."
            />
            <SelectField
              label="Tiles"
              value={String(stretchParams.claheTiles)}
              onChange={(v) => setS("claheTiles", parseInt(v, 10))}
              options={[
                { value: "4", label: "4 × 4" },
                { value: "8", label: "8 × 8" },
                { value: "16", label: "16 × 16" },
              ]}
              hint="Adaptive grid — finer = more local."
            />
          </>
        )}

        {showClipCaveat && (
          <p className="text-[11px] leading-relaxed text-[color:var(--color-ink-subtle)]">
            Clipping discards extreme pixels — keep it low to preserve peak
            depth.
          </p>
        )}

        <Toggle
          label="Remove empty layers"
          checked={stretchParams.removeEmptyLayers}
          onChange={(v) => setS("removeEmptyLayers", v)}
          hint="Offset the lowest value to 0 — drops layers the machine would otherwise cut as air. Most visible with Mode = None."
        />
      </Section>
    </>
  );
}
