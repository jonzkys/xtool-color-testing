import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../../lib/forge/spiralParams";
import { descentDepthMm } from "../../lib/forge/depth";
import { Field, Input, Section } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** The non-swept cut parameters. Every sweepable param has an input here; the
 *  two currently on an axis are disabled (their value comes from the axis). */
export function FixedParams({ cfg, onChange }: Props) {
  const setFixed = (k: ParamKey, v: number) =>
    onChange({ ...cfg, fixed: { ...cfg.fixed, [k]: PARAMS[k].clamp(v) } });

  const onAxis = (k: ParamKey): "X" | "Y" | null =>
    k === cfg.xParam ? "X" : k === cfg.yParam ? "Y" : null;

  // Descent depth uses the fixed values; it varies per cell (so reads "—") when
  // any of its inputs (passes / focus step / focus interval) is on an axis.
  const depthVaries = (["passes", "focusStep", "focusInterval"] as ParamKey[]).some((k) => onAxis(k) !== null);
  const depth = descentDepthMm(cfg.fixed.passes, cfg.fixed.focusInterval, cfg.fixed.focusStep);

  return (
    <Section title="Fixed params" dense>
      <div className="grid grid-cols-2 gap-2">
        {PARAM_ORDER.map((k) => {
          const ax = onAxis(k);
          return (
            <Field key={k} label={`${PARAMS[k].label}${ax ? ` (on ${ax})` : ` (${PARAMS[k].unit})`}`}>
              <Input aria-label={`fixed ${k}`} type="number" mono value={cfg.fixed[k]} disabled={ax !== null}
                onChange={(e) => setFixed(k, num(e.target.value, cfg.fixed[k]))} />
            </Field>
          );
        })}
        <Field label="Initial drop (mm)">
          <Input aria-label="focus initial" type="number" mono step={0.01} value={cfg.focusInitialMm}
            onChange={(e) => onChange({ ...cfg, focusInitialMm: Math.max(0, num(e.target.value, cfg.focusInitialMm)) })} />
        </Field>
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
        {depthVaries ? "Descent @ varies: —" : `Descent @ ${cfg.fixed.passes}p: ${depth.toFixed(3)} mm`}
      </p>
    </Section>
  );
}
