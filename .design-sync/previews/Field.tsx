import { useState } from "react";
import { Field, Input, Select, Textarea } from "xcs-gen-web";

export function MaterialForm() {
  const [name, setName] = useState("Brass 3.0mm");
  const [shape, setShape] = useState("rect");
  const [notes, setNotes] = useState("Batch from the March order — softer than the offcuts.");
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Shape" hint="Feeds the Tests page auto-fit.">
        <Select value={shape} onChange={(e) => setShape(e.target.value)}>
          <option value="none">None — no auto-fit</option>
          <option value="circle">Circle</option>
          <option value="rect">Rectangle</option>
        </Select>
      </Field>
      <Field label="Notes" hint="Optional — anything that helps you remember this batch.">
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </div>
  );
}

export function WithHelp() {
  return (
    <div className="max-w-[420px]">
      <Field
        label="Output style"
        help={
          <span>
            <b>Spline</b> emits cubic Bézier paths — smooth curves, but the Simplify
            tolerance slider does nothing because it skips curved paths.
            <br />
            <br />
            <b>Polygon</b> emits M/L-only paths — faceted, but the slider can collapse
            vertex chains.
          </span>
        }
        hint="Polygon is the safer choice when the firmware flattens curves anyway."
      >
        <Select defaultValue="spline">
          <option value="spline">Spline — cubic Bézier</option>
          <option value="polygon">Polygon — M/L only</option>
        </Select>
      </Field>
    </div>
  );
}

export function HintVersusError() {
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="QR size (mm)" hint="blank = default (5 mm)">
        <Input mono type="number" step="any" placeholder="5" />
      </Field>
      <Field label="Speed (mm/s)" error="Above the F2 Ultra ceiling of 4000 mm/s.">
        <Input mono invalid defaultValue="6200" />
      </Field>
      <Field
        label="Passes"
        hint="This hint is suppressed — error wins."
        error="Passes must be at least 1."
      >
        <Input mono invalid defaultValue="0" />
      </Field>
    </div>
  );
}

export function InlineRows() {
  const [material, setMaterial] = useState("");
  const [laser, setLaser] = useState("red");
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <Field label="Material" inline>
        <Select value={material} onChange={(e) => setMaterial(e.target.value)}>
          <option value="">— all materials —</option>
          <option value="brass-3">Brass 3.0mm</option>
          <option value="steel-card">Stainless steel card</option>
        </Select>
      </Field>
      <Field label="Laser" inline hint="MOPA red is the only head that marks brass.">
        <Select value={laser} onChange={(e) => setLaser(e.target.value)}>
          <option value="red">Red (MOPA)</option>
          <option value="blue">Blue (diode)</option>
        </Select>
      </Field>
      <Field label="Pulse width (ns)" inline error="Snapped to the nearest legal preset: 200.">
        <Input mono invalid defaultValue="235" />
      </Field>
    </div>
  );
}

export function DenseGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 max-w-[420px]">
      <Field label="Angle (°)">
        <Input mono defaultValue="45" />
      </Field>
      <Field label="Spacing (mm)">
        <Input mono defaultValue="0.12" />
      </Field>
      <Field label="Thickness (mm)">
        <Input mono defaultValue="3.0" />
      </Field>
      <Field label="Passes">
        <Input mono defaultValue="4" />
      </Field>
      <Field label="Machine" className="col-span-2">
        <Select defaultValue="f2-ultra">
          <option value="f2-ultra">F2 Ultra</option>
          <option value="p2">P2</option>
          <option value="m1">M1</option>
        </Select>
      </Field>
    </div>
  );
}
