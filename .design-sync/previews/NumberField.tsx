import { useState } from "react";
import { NumberField } from "xcs-gen-web";

export function PassGeometry() {
  const [angle, setAngle] = useState(45);
  const [spacing, setSpacing] = useState(0.12);
  const [thickness, setThickness] = useState(2);
  return (
    <div className="grid grid-cols-3 gap-2">
      <NumberField label="Angle (°)" value={angle} onChange={setAngle} min={0} max={180} integer />
      <NumberField label="Spacing (mm)" value={spacing} onChange={setSpacing} step={0.01} min={0.01} />
      <NumberField label="Thickness (mm)" value={thickness} onChange={setThickness} step={0.1} />
    </div>
  );
}

export function WithHelpAndHint() {
  const [speed, setSpeed] = useState(1200);
  return (
    <div className="max-w-[420px]">
      <NumberField
        label="Speed (mm/s)"
        value={speed}
        onChange={setSpeed}
        integer
        min={1}
        max={4000}
        help="Speed barely moves total cut time on this machine — passes and focus steps dominate."
        hint="Machine ceiling is 4000 mm/s."
      />
    </div>
  );
}

export function Invalid() {
  const [power, setPower] = useState(140);
  return (
    <div className="max-w-[420px]">
      <NumberField
        label="Power (%)"
        value={power}
        onChange={setPower}
        integer
        min={0}
        max={100}
        issue="Power must be between 0 and 100."
      />
    </div>
  );
}

export function InlineAndDisabled() {
  const [passes, setPasses] = useState(4);
  return (
    <div className="flex flex-col gap-3 max-w-[420px]">
      <NumberField label="Passes" value={passes} onChange={setPasses} integer min={1} inline />
      <NumberField label="Pulse width (ns)" value={200} onChange={() => {}} inline disabled />
    </div>
  );
}
