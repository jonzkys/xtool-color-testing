import { useState } from "react";
import { Field, Select } from "xcs-gen-web";

export function MaterialAndPreset() {
  const [material, setMaterial] = useState("brass-3");
  const [preset, setPreset] = useState("burnt-copper");
  const swatch = preset === "burnt-copper" ? "#7A4A1E" : "#2E2A26";
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Field label="Material">
        <Select
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          className="min-w-[160px]"
        >
          <option value="brass-3">Brass 3.0mm</option>
          <option value="brass-1">Brass 1.0mm</option>
          <option value="steel-card">Stainless steel card</option>
          <option value="anod-alu">Anodised aluminium</option>
        </Select>
      </Field>
      <Field label="Preset" hint="60% power · 900 mm/s · 4 passes · 200 ns">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-4 w-4 shrink-0 rounded-[4px] border border-[color:var(--color-border-strong)]"
            style={{ background: swatch }}
          />
          <Select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="min-w-[160px]"
          >
            <option value="burnt-copper">Burnt copper</option>
            <option value="deep-black">Deep black</option>
            <option value="frosted-etch">Frosted etch</option>
          </Select>
        </div>
      </Field>
    </div>
  );
}

export function ProcessingType() {
  const [type, setType] = useState("VECTOR_CUTTING");
  const [angleMode, setAngleMode] = useState("incremental");
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Processing type">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="COLOR_FILL_ENGRAVE">Color fill engrave</option>
          <option value="FILL_VECTOR_ENGRAVING">Fill vector engrave</option>
          <option value="VECTOR_ENGRAVING">Vector engrave</option>
          <option value="VECTOR_CUTTING">Vector cut</option>
          <option value="HATCHED_LINES">Hatched lines</option>
        </Select>
      </Field>
      <Field label="Angle mode" hint="Incremental lets XCS rotate the scan angle per pass.">
        <Select value={angleMode} onChange={(e) => setAngleMode(e.target.value)}>
          <option value="fixed">Fixed — all passes at scan angle</option>
          <option value="incremental">Incremental — XCS rotates per pass</option>
        </Select>
      </Field>
    </div>
  );
}

export function InvalidUnpicked() {
  return (
    <div className="max-w-[420px]">
      <Field label="Material" error="Pick a material before saving the swatch.">
        <Select invalid defaultValue="">
          <option value="">— pick a material —</option>
          <option value="brass-3">Brass 3.0mm</option>
          <option value="steel-card">Stainless steel card</option>
        </Select>
      </Field>
    </div>
  );
}

export function DisabledAndDisabledOption() {
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Preset" hint="No presets saved for this material yet.">
        <Select disabled defaultValue="none">
          <option value="none">— no presets —</option>
        </Select>
      </Field>
      <Field label="Strategy">
        <Select defaultValue="lean">
          <option value="lean">Lean (fast)</option>
          <option value="aggressive">Aggressive (deep 1/2/4/8)</option>
          <option value="custom" disabled>
            Custom
          </option>
        </Select>
      </Field>
    </div>
  );
}
