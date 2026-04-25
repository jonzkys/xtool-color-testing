import { useEffect, useState } from "react";
import {
  Button, Card, Dialog, DialogContent, DialogTitle,
  Field, Input, NumberField, Section, Select,
} from "../ui";
import { PulseWidthSelect } from "./PulseWidthSelect";
import type { BaseParams, PaletteEntry } from "../types";
import type { Material } from "../library";
import { defaultBaseParams } from "../defaults";
import { createManualPaletteEntry, patchPaletteEntry } from "../api/palette";
import { getCurrentMachineId } from "../state/machine";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface PaletteEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materials: Material[];
  /** When set, dialog is in EDIT mode for that entry. */
  entry?: PaletteEntry | null;
  /** Default material id for new entries. */
  defaultMaterialId?: string;
  onSaved: (entry: PaletteEntry) => void;
}

export function PaletteEntryDialog({
  open, onOpenChange, materials, entry, defaultMaterialId, onSaved,
}: PaletteEntryDialogProps) {
  const isEdit = !!entry;
  const [hex, setHex] = useState("#cccccc");
  const [materialId, setMaterialId] = useState<string>(defaultMaterialId ?? "");
  const [notes, setNotes] = useState("");
  const [params, setParams] = useState<BaseParams>(defaultBaseParams());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    if (entry) {
      setHex(entry.hex);
      setMaterialId(String(entry.material_id));
      setNotes(entry.notes);
      setParams({ ...defaultBaseParams(), ...paletteParamsToBase(entry.params) });
    } else {
      setHex("#cccccc");
      setMaterialId(defaultMaterialId ?? "");
      setNotes("");
      setParams(defaultBaseParams());
    }
  }, [open, entry, defaultMaterialId]);

  const hexValid = HEX_RE.test(hex);
  const canSave = hexValid && materialId !== "" && !saving;

  async function onSave() {
    setSaving(true);
    setError(undefined);
    try {
      let saved: PaletteEntry;
      const paramsRecord = baseToPaletteParams(params);
      if (isEdit && entry) {
        saved = await patchPaletteEntry(entry.id, {
          hex, material_id: Number(materialId),
          params: paramsRecord, notes,
        });
      } else {
        saved = await createManualPaletteEntry({
          material_id: Number(materialId),
          hex, params: paramsRecord, notes,
          machine_id: getCurrentMachineId(),
        });
      }
      onSaved(saved);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width="lg">
        <DialogTitle>{isEdit ? "Edit swatch" : "New manual swatch"}</DialogTitle>

        <div className="grid gap-5 mt-3">
          <Card padded={false} className="p-3">
            <Section title="Identity" dense>
              <Field label="Material">
                <Select
                  value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}
                  invalid={materialId === ""}
                >
                  {materialId === "" && <option value="">— pick a material —</option>}
                  {materials.map((m) => (
                    <option key={m.id} value={String(m.id)}>{m.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Hex">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={hexValid ? hex : "#cccccc"}
                    onChange={(e) => setHex(e.target.value)}
                    aria-label="Pick hex"
                    className="h-9 w-12 rounded-[6px] border border-[color:var(--color-border-strong)] cursor-pointer p-1"
                  />
                  <Input
                    mono
                    value={hex}
                    onChange={(e) => setHex(e.target.value)}
                    invalid={!hexValid}
                    className="w-[160px]"
                  />
                </div>
              </Field>
              <Field label="Label / notes">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. burnt copper, 1 mm gold"
                />
              </Field>
            </Section>
          </Card>

          <Card padded={false} className="p-3">
            <Section title="Recipe" dense>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Power %"
                  value={params.power}
                  onChange={(v) => setParams({ ...params, power: v })}
                />
                <NumberField
                  label="Speed (mm/s)"
                  value={params.speed}
                  integer
                  onChange={(v) => setParams({ ...params, speed: v })}
                />
                <NumberField
                  label="Frequency (Hz)"
                  value={params.frequency}
                  integer
                  onChange={(v) => setParams({ ...params, frequency: v })}
                />
                <NumberField
                  label="Lines/cm"
                  value={params.density}
                  integer
                  onChange={(v) => setParams({ ...params, density: v })}
                />
                <NumberField
                  label="Passes"
                  value={params.passes}
                  integer
                  min={1}
                  onChange={(v) => setParams({ ...params, passes: v })}
                />
                <PulseWidthSelect
                  value={params.pulse_width}
                  onChange={(v) => setParams({ ...params, pulse_width: v })}
                />
                <div className="col-span-2">
                  <Field label="Laser">
                    <Select
                      value={params.laser}
                      onChange={(e) =>
                        setParams({ ...params, laser: e.target.value as "red" | "blue" })
                      }
                    >
                      <option value="red">Red (MOPA)</option>
                      <option value="blue">Blue (diode)</option>
                    </Select>
                  </Field>
                </div>
              </div>
            </Section>
          </Card>

          {error && (
            <p className="text-[12px] text-[color:var(--color-destructive)]">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" onClick={onSave} disabled={!canSave}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create swatch"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function paletteParamsToBase(p: Record<string, string | number>): Partial<BaseParams> {
  const num = (k: string) =>
    p[k] === undefined ? undefined : Number(p[k]);
  const laser = p["laser"] === "blue" ? "blue" : "red";
  return {
    power: num("power"),
    speed: num("speed"),
    frequency: num("frequency"),
    density: num("density"),
    passes: num("passes"),
    pulse_width: num("pulse_width"),
    laser,
  };
}

function baseToPaletteParams(b: BaseParams): Record<string, string | number> {
  return {
    power: b.power, speed: b.speed, frequency: b.frequency,
    density: b.density, passes: b.passes, pulse_width: b.pulse_width,
    laser: b.laser, scan_angle: b.scan_angle,
  };
}
