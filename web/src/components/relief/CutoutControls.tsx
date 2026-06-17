/**
 * Relief — Cutout controls.
 *
 * The depth map's silhouette: lift the object off its background, then shape
 * the cut edge. Everything here keys off "Remove background" — the edge
 * shaping (smooth / trim / falloff) only applies once there's an alpha to
 * shape, so it's revealed under the toggle. Hints live in ``?`` tooltips to
 * keep the panel compact.
 */

import { Field } from "../../ui";
import type { StretchParams } from "./stretch";
import { LabelHint, SelectField, Slider, Toggle } from "./fields";

export interface CutoutControlsProps {
  params: StretchParams;
  onChange: (p: StretchParams) => void;
  onPickColor: () => void;
}

export function CutoutControls({ params, onChange, onPickColor }: CutoutControlsProps) {
  const set = <K extends keyof StretchParams>(key: K, value: StretchParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <>
      <Toggle
        label="Remove background"
        checked={params.removeBackground}
        onChange={(v) => set("removeBackground", v)}
        hint="Make the surrounding background transparent — it won't be engraved, and it's excluded from the stretch."
      />

      {params.removeBackground && (
        <>
          <SelectField
            label="Method"
            ariaLabel="Background removal method"
            value={params.bgMode}
            onChange={(v) => set("bgMode", v as StretchParams["bgMode"])}
            options={[
              { value: "dark", label: "Dark threshold" },
              { value: "bright", label: "Bright threshold" },
              { value: "colour", label: "Pick colour" },
            ]}
            hint="How the background is detected: a dark/bright luminance cut, or keying out a colour you pick."
          />

          {params.bgMode !== "colour" ? (
            <Slider
              label="Threshold"
              value={params.bgThreshold}
              min={0}
              max={255}
              step={1}
              onChange={(v) => set("bgThreshold", v)}
              hint="Pixels at or below (dark) / above (bright) this value become transparent."
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onPickColor}
                  className="rounded-[5px] border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-primary)]/50"
                >
                  Pick from image
                </button>
                <span
                  className="inline-block h-5 w-5 rounded-[4px] border border-[var(--color-border)]"
                  style={{
                    background: params.bgColor
                      ? `rgb(${params.bgColor.join(",")})`
                      : "transparent",
                  }}
                  aria-hidden
                />
                <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
                  {params.bgColor ? params.bgColor.join(", ") : "no colour picked"}
                </span>
              </div>
              <Slider
                label="Tolerance"
                value={params.bgTolerance}
                min={0}
                max={200}
                step={1}
                onChange={(v) => set("bgTolerance", v)}
                hint="How far a pixel's colour can be from the picked colour and still count as background."
              />
            </>
          )}

          {/* ── Edge shaping (depends on the alpha above) ──────────────── */}
          <div
            aria-hidden
            className="mt-1 h-px"
            style={{ background: "var(--metal-bar-soft)" }}
          />
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--color-ink-subtle)]">
            Edge shaping
          </div>

          <Toggle
            label="Smooth edge"
            checked={params.perimeterEnabled}
            onChange={(v) => set("perimeterEnabled", v)}
            hint="Round the jagged silhouette outline — smooths the engraved wall and any tapered rim."
          />
          {params.perimeterEnabled && (
            <Slider
              label="Smooth %"
              value={params.perimeterPct}
              min={0}
              max={15}
              step={0.5}
              onChange={(v) => set("perimeterPct", v)}
            />
          )}

          <Toggle
            label="Trim outline"
            checked={params.trimEnabled}
            onChange={(v) => set("trimEnabled", v)}
            hint="Erode the object outline by a % of its shorter side — removes a fuzzy border."
          />
          {params.trimEnabled && (
            <Slider
              label="Trim %"
              value={params.trimPct}
              min={0}
              max={25}
              step={0.5}
              onChange={(v) => set("trimPct", v)}
            />
          )}

          <Toggle
            label="Edge falloff"
            checked={params.falloffEnabled}
            onChange={(v) => set("falloffEnabled", v)}
            hint="Soften the cut edge: bevel a band inside the object, or grow an outward raised border (berm)."
          />
          {params.falloffEnabled && (
            <>
              <SelectField
                label="Falloff mode"
                ariaLabel="Edge falloff mode"
                value={params.falloffMode}
                onChange={(v) => set("falloffMode", v as StretchParams["falloffMode"])}
                options={[
                  { value: "inward", label: "Inward — bevel the object edge" },
                  { value: "outward", label: "Outward — raised border (berm)" },
                ]}
              />
              <Slider
                label="Taper to %"
                value={params.falloffTarget}
                min={0}
                max={100}
                step={1}
                onChange={(v) => set("falloffTarget", v)}
                hint="Level the edge ramps to — 0 = floor, 100 = peak (outward: berm crest height)."
              />
              <Slider
                label="Offset %"
                value={params.falloffPct}
                min={0}
                max={50}
                step={0.5}
                onChange={(v) => set("falloffPct", v)}
                hint="Width of the falloff band as a % of the object's shorter side."
              />
              <Slider
                label="Intensity"
                value={params.falloffIntensity}
                min={0}
                max={100}
                step={1}
                onChange={(v) => set("falloffIntensity", v)}
                hint="Falloff curve steepness — 0 gentle (linear), 100 sharp."
              />
            </>
          )}
        </>
      )}

      {!params.removeBackground && (
        <Field label={<LabelHint>Edge shaping</LabelHint>}>
          <p className="text-[11px] leading-relaxed text-[color:var(--color-ink-subtle)]">
            Turn on background removal to trim, smooth, or taper the cut edge.
          </p>
        </Field>
      )}
    </>
  );
}
