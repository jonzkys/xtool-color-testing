import { useState } from "react";
import { Field, Input } from "xcs-gen-web";

export function ProjectIdentity() {
  const [name, setName] = useState("brass-tag-run7.xcs");
  const [height, setHeight] = useState("");
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Output filename">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Height (mm)" hint="blank = aspect">
        <Input
          mono
          type="number"
          step="any"
          value={height}
          placeholder="auto"
          onChange={(e) => setHeight(e.target.value)}
        />
      </Field>
    </div>
  );
}

export function MonoHexRow() {
  const [hex, setHex] = useState("#7A4A1E");
  return (
    <div className="max-w-[420px]">
      <Field label="Hex" hint="Target colour for the validated palette match.">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-9 w-12 shrink-0 rounded-[6px] border border-[color:var(--color-border-strong)]"
            style={{ background: hex }}
          />
          <Input mono value={hex} onChange={(e) => setHex(e.target.value)} className="w-[160px]" />
        </div>
      </Field>
    </div>
  );
}

export function Invalid() {
  return (
    <div className="max-w-[420px]">
      <Field label="Hex" error="Not a 6-digit hex colour — e.g. #7A4A1E.">
        <Input mono invalid defaultValue="#7a4z1e" className="w-[160px]" />
      </Field>
    </div>
  );
}

export function States() {
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Material name">
        <Input placeholder="e.g. Stainless steel card" />
      </Field>
      <Field label="Machine" hint="Read-only — set by the connected device.">
        <Input readOnly value="F2 Ultra" />
      </Field>
      <Field label="Pulse width (ns)">
        <Input mono disabled value="200" />
      </Field>
    </div>
  );
}
