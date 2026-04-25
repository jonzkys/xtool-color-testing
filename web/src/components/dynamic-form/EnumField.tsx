import { Field, Select } from "../../ui";

interface Props {
  label: string;
  values: (number | string)[];
  value: number | string;
  onChange: (v: number | string) => void;
  disabled?: boolean;
}

/** Small `<select>` for enum-constrained fields.
 *
 * Visually identical to the other Select controls throughout the
 * Workbench — same height, border, and focus ring.
 */
export function EnumField({ label, values, value, onChange, disabled }: Props) {
  return (
    <Field label={label}>
      <Select
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          // Preserve numeric type when the values array is numeric.
          if (values.length > 0 && typeof values[0] === "number") {
            onChange(Number(raw));
          } else {
            onChange(raw);
          }
        }}
      >
        {values.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
