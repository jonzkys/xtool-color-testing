import { DynamicParamForm } from "./dynamic-form/DynamicParamForm";
import { useCurrentMachine, getValidationProfile, representativeMode } from "../state/machine";
import type { BaseParams, ModeId } from "../types";

/**
 * Compact editor for the user-facing BaseParams fields, driven by the active
 * machine's validation profile (resolved from useCurrentMachine + a mode).
 * Renders the shared DynamicParamForm so every base-params surface shows the
 * same real per-machine/mode constraints. Non-form fields on `value`
 * (e.g. scan_angle, mode) are preserved across edits.
 */
export interface BaseParamsEditorProps {
  value: BaseParams;
  onChange: (value: BaseParams) => void;
  disabled?: boolean;
  /** Override the mode whose profile constrains the fields. Defaults to the
   *  machine's representative mode (color_engrave if supported, else engrave). */
  mode?: ModeId;
}

export function BaseParamsEditor({ value, onChange, disabled, mode }: BaseParamsEditorProps) {
  const { registry, machineId, machine } = useCurrentMachine();
  const resolvedMode: ModeId = mode ?? (machine ? representativeMode(machine) : "engrave");
  const profile = getValidationProfile(registry, machineId, resolvedMode);

  if (!profile) {
    return (
      <p className="font-mono text-[11px] tracking-[0.04em] text-[color:var(--color-ink-subtle)]">
        Loading constraints…
      </p>
    );
  }

  return (
    <DynamicParamForm
      profile={profile}
      value={value as unknown as Record<string, number | string>}
      onChange={(next) => onChange({ ...value, ...(next as Partial<BaseParams>) })}
      disabled={disabled}
    />
  );
}
