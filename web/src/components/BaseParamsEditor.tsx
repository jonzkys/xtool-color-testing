import { Field, NumberField, Select } from "../ui";
import { PulseWidthSelect } from "./PulseWidthSelect";
import type { BaseParams } from "../types";

/**
 * Compact, two-column editor for the seven user-tunable knobs that make
 * up a `BaseParams` recipe. Extracted from PaletteEntryDialog / LoomPage
 * so the WB-calibration panel can render the same layout for the
 * clean-pass and per-patch params without duplicating the markup.
 *
 * Intentionally minimal — `scan_angle` is omitted because the contexts
 * that need it (Tests, Layers) drive it from a separate angle-mode
 * control. Callers that need it should compose this with their own
 * angle-mode picker (see PaletteEntryDialog for an example).
 */
export interface BaseParamsEditorProps {
  value: BaseParams;
  onChange: (next: BaseParams) => void;
  disabled?: boolean;
}

export function BaseParamsEditor({
  value,
  onChange,
  disabled,
}: BaseParamsEditorProps) {
  const patch = (p: Partial<BaseParams>) => onChange({ ...value, ...p });
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label="Power %"
        value={value.power}
        min={0}
        max={100}
        disabled={disabled}
        onChange={(v) => patch({ power: v })}
      />
      <NumberField
        label="Speed (mm/s)"
        value={value.speed}
        integer
        min={1}
        disabled={disabled}
        onChange={(v) => patch({ speed: v })}
      />
      <NumberField
        label="Frequency (Hz)"
        value={value.frequency}
        integer
        min={1}
        disabled={disabled}
        onChange={(v) => patch({ frequency: v })}
      />
      <NumberField
        label="Lines/cm"
        value={value.density}
        integer
        min={1}
        disabled={disabled}
        onChange={(v) => patch({ density: v })}
      />
      <NumberField
        label="Passes"
        value={value.passes}
        integer
        min={1}
        disabled={disabled}
        onChange={(v) => patch({ passes: v })}
      />
      <PulseWidthSelect
        value={value.pulse_width}
        disabled={disabled}
        onChange={(v) => patch({ pulse_width: v })}
      />
      <div className="col-span-2">
        <Field label="Laser">
          <Select
            value={value.laser}
            disabled={disabled}
            onChange={(e) =>
              patch({ laser: e.target.value as "red" | "blue" })
            }
          >
            <option value="red">Red (MOPA)</option>
            <option value="blue">Blue (diode)</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}
