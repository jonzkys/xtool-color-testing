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
import type { StretchParams, SubMethod, Subtraction } from "./stretch";
import { defaultSubtraction } from "./stretch";
import { LabelHint, SelectField, Slider, Toggle } from "./fields";

export interface CutoutControlsProps {
  params: StretchParams;
  onChange: (p: StretchParams) => void;
  /** Begin picking a colour/seed for the subtraction row at `index`. */
  onPickColor: (index: number) => void;
}

export function CutoutControls({ params, onChange, onPickColor }: CutoutControlsProps) {
  const set = <K extends keyof StretchParams>(key: K, value: StretchParams[K]) =>
    onChange({ ...params, [key]: value });

  return (
    <>
      <Slider
        label="Expand canvas %"
        value={params.expandPct}
        min={0}
        max={50}
        step={1}
        onChange={(v) => set("expandPct", v)}
        hint="Pad the image with the background colour so an object near the border has room for an outward berm / offset. With background removal on, the padding is cleared; 0 = no padding."
      />

      <Toggle
        label="Remove background"
        checked={params.removeBackground}
        onChange={(v) => set("removeBackground", v)}
        hint="Make the surrounding background transparent — it won't be engraved, and it's excluded from the stretch."
      />

      {params.removeBackground && (
        <>
          {params.subtractions.map((sub, i) => (
            <SubtractionRow
              key={i}
              index={i}
              sub={sub}
              canRemove={params.subtractions.length > 1}
              onChange={(next) =>
                set(
                  "subtractions",
                  params.subtractions.map((s, j) => (j === i ? next : s)),
                )
              }
              onRemove={() =>
                set(
                  "subtractions",
                  params.subtractions.filter((_, j) => j !== i),
                )
              }
              onPick={() => onPickColor(i)}
            />
          ))}
          <button
            type="button"
            onClick={() => set("subtractions", [...params.subtractions, defaultSubtraction()])}
            className="self-start rounded-[5px] border border-dashed border-[var(--color-border)] px-2 py-1 text-[11px] text-[color:var(--color-ink-muted)] hover:border-[var(--color-primary)]/50 hover:text-[color:var(--color-ink)]"
          >
            + Subtract another
          </button>

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

          <Toggle
            label="Shape internal edges"
            checked={params.shapeInternal}
            onChange={(v) => set("shapeInternal", v)}
            hint="Apply the edge shaping above to internal holes (e.g. an inner pocket) too. Off = only the outer silhouette is shaped; holes stay hard-edged."
          />
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

const METHOD_OPTIONS: { value: SubMethod; label: string }[] = [
  { value: "dark", label: "Dark threshold" },
  { value: "bright", label: "Bright threshold" },
  { value: "colour", label: "Pick colour" },
  { value: "area", label: "Pick area" },
];

function SubtractionRow({
  index,
  sub,
  canRemove,
  onChange,
  onRemove,
  onPick,
}: {
  index: number;
  sub: Subtraction;
  canRemove: boolean;
  onChange: (next: Subtraction) => void;
  onRemove: () => void;
  onPick: () => void;
}) {
  const isColourLike = sub.method === "colour" || sub.method === "area";
  return (
    <div className="flex flex-col gap-2 rounded-[6px] border border-[color:var(--color-border)] p-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <SelectField
            label={`Subtraction ${index + 1}`}
            ariaLabel={`Subtraction ${index + 1} method`}
            value={sub.method}
            onChange={(v) =>
              // Drop the seed on any method change — it pins a specific click
              // location that only ``area`` uses, and a stale one would key the
              // wrong region after switching modes.
              onChange({ ...sub, method: v as SubMethod, seedX: null, seedY: null })
            }
            options={METHOD_OPTIONS}
            hint="How this layer detects background: a dark/bright luminance cut, a global colour key, or a connected area (only the region you click)."
          />
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove subtraction ${index + 1}`}
            className="mb-0.5 rounded-[5px] border border-[var(--color-border)] px-2 py-1 text-xs text-[color:var(--color-ink-muted)] hover:border-[var(--color-primary)]/50 hover:text-[color:var(--color-ink)]"
          >
            ×
          </button>
        )}
      </div>

      {!isColourLike ? (
        <Slider
          label="Threshold"
          value={sub.threshold}
          min={0}
          max={255}
          step={1}
          onChange={(v) => onChange({ ...sub, threshold: v })}
          hint="Pixels at or below (dark) / above (bright) this value become transparent."
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPick}
              className="rounded-[5px] border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-primary)]/50"
            >
              {sub.method === "area" ? "Pick area from image" : "Pick from image"}
            </button>
            <span
              className="inline-block h-5 w-5 rounded-[4px] border border-[var(--color-border)]"
              style={{ background: sub.color ? `rgb(${sub.color.join(",")})` : "transparent" }}
              aria-hidden
            />
            <span className="font-mono text-[10px] text-[var(--color-ink-muted)]">
              {sub.color ? sub.color.join(", ") : "no colour picked"}
            </span>
          </div>
          <Slider
            label="Tolerance"
            value={sub.tolerance}
            min={0}
            max={200}
            step={1}
            onChange={(v) => onChange({ ...sub, tolerance: v })}
            hint="How far a pixel's colour can be from the picked colour and still count as background."
          />
        </>
      )}
    </div>
  );
}
