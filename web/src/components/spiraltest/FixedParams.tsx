import type { SpiralTestConfig } from "../../lib/forge/spiralTest";
import type { ValidationProfile } from "../../types";
import { PARAMS, PARAM_ORDER, type ParamKey } from "../../lib/forge/spiralParams";
import { clampParam, constraintFor, snapStepped, steppedValues } from "../../lib/forge/spiralLimits";
import { descentDepthMm } from "../../lib/forge/depth";
import { Field, Input, Section, Select } from "../../ui";

interface Props {
  cfg: SpiralTestConfig;
  onChange: (c: SpiralTestConfig) => void;
  profile?: ValidationProfile | null;
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** The non-swept cut parameters. Every sweepable param has an input here; the
 *  two currently on an axis are disabled (their value comes from the axis).
 *  Values clamp/snap to the machine profile on edit; pulse width is discrete. */
export function FixedParams({ cfg, onChange, profile = null }: Props) {
  const setFixed = (k: ParamKey, v: number) =>
    onChange({ ...cfg, fixed: { ...cfg.fixed, [k]: clampParam(profile, k, v) } });

  const onAxis = (k: ParamKey): "X" | "Y" | null =>
    k === cfg.xParam ? "X" : k === cfg.yParam ? "Y" : null;

  const depthVaries = (["passes", "focusStep", "focusInterval"] as ParamKey[]).some((k) => onAxis(k) !== null);
  const depth = descentDepthMm(cfg.fixed.passes, cfg.fixed.focusInterval, cfg.fixed.focusStep);

  return (
    <Section title="Fixed params" dense>
      <div className="grid grid-cols-2 gap-2">
        {PARAM_ORDER.map((k) => {
          const ax = onAxis(k);
          const label = `${PARAMS[k].label}${ax ? ` (on ${ax})` : ` (${PARAMS[k].unit})`}`;
          const opts = steppedValues(profile, k);
          if (opts) {
            // Discrete (pulse width): a select of the machine's allowed values.
            return (
              <Field key={k} label={label}>
                <Select aria-label={`fixed ${k}`} value={String(snapStepped(opts, cfg.fixed[k]))} disabled={ax !== null}
                  onChange={(e) => setFixed(k, Number(e.target.value))}>
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </Field>
            );
          }
          const c = constraintFor(profile, k);
          const rangeAttrs = c?.kind === "range" ? { min: c.min, max: c.max } : {};
          return (
            <Field key={k} label={label}>
              <Input aria-label={`fixed ${k}`} type="number" mono step={PARAMS[k].step} value={cfg.fixed[k]}
                disabled={ax !== null} {...rangeAttrs}
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
