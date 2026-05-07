import { Field, NumberField, Select } from "../ui";
import type { BaseParams, Laser } from "../types";

/**
 * Compact editor for the seven user-facing fields of ``BaseParams``
 * (no scan_angle — calibration burns are uniform pads, not directional
 * sweeps). Used by the Calibration section of the material edit dialog
 * and intended to be reusable for any future "burn recipe" surface
 * that doesn't need the full mode-aware DynamicParamForm.
 *
 * The prop shape mirrors the static fallback in ``ParamTestEditor``'s
 * ``BaseParamsSection`` — ``label`` lives on the ``NumberField`` itself
 * rather than wrapping with ``<Field>``, matching the existing idiom.
 */

export interface BaseParamsEditorProps {
  value: BaseParams;
  onChange: (value: BaseParams) => void;
  disabled?: boolean;
}

export function BaseParamsEditor({ value, onChange, disabled }: BaseParamsEditorProps) {
  const update = <K extends keyof BaseParams>(k: K, v: BaseParams[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="grid grid-cols-2 gap-3" aria-disabled={disabled}>
      <NumberField
        label="Power %"
        value={value.power}
        min={0}
        max={100}
        step={0.1}
        disabled={disabled}
        onChange={(v) => update("power", v)}
      />
      <NumberField
        label="Speed (mm/s)"
        value={value.speed}
        min={1}
        integer
        disabled={disabled}
        onChange={(v) => update("speed", v)}
      />
      <NumberField
        label="Frequency (kHz)"
        value={value.frequency}
        min={1}
        integer
        disabled={disabled}
        onChange={(v) => update("frequency", v)}
      />
      <NumberField
        label="Lines/cm"
        value={value.density}
        min={1}
        integer
        disabled={disabled}
        onChange={(v) => update("density", v)}
      />
      <NumberField
        label="Passes"
        value={value.passes}
        min={1}
        integer
        disabled={disabled}
        onChange={(v) => update("passes", v)}
      />
      <NumberField
        label="Pulse width (ns)"
        value={value.pulse_width}
        min={1}
        integer
        disabled={disabled}
        onChange={(v) => update("pulse_width", v)}
      />
      <Field label="Laser" className="col-span-2">
        <Select
          value={value.laser}
          disabled={disabled}
          onChange={(e) => update("laser", e.target.value as Laser)}
        >
          <option value="red">Red (MOPA)</option>
          <option value="blue">Blue (diode)</option>
        </Select>
      </Field>
    </div>
  );
}
