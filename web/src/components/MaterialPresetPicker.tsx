import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { LibraryState, Preset } from "../library";
import { Badge, Button, Card, Field, Select } from "../ui";

interface Props {
  library: LibraryState;
  materialId: string | null;
  baseParams: Preset["base_params"];
  onApply: (materialId: string, baseParams: Preset["base_params"]) => void;
}

/**
 * Material + preset dropdown with an explicit Apply button.
 *
 * Shows a status indicator:
 *  - ✓ Applied   — baseParams exactly matches the last-applied preset
 *  - Modified   — the user has edited base_params since applying
 *  - (nothing)  — no preset has been applied in this session yet
 *
 * Ported to the redesign primitives; the state machine is preserved
 * verbatim.
 */
export function MaterialPresetPicker({
  library,
  materialId,
  baseParams,
  onApply,
}: Props) {
  const activeMaterialStr =
    library.active_material_id !== null
      ? String(library.active_material_id)
      : library.materials[0]
        ? String(library.materials[0].id)
        : "";
  const effectiveMaterialId = materialId ?? activeMaterialStr;
  const [dropdownMaterialId, setDropdownMaterialId] = useState<string>(effectiveMaterialId);

  const presetsForDropdown = library.presets.filter(
    (p) => String(p.material_id) === dropdownMaterialId,
  );
  const defaultPreset =
    presetsForDropdown.find((p) => p.is_default) ?? presetsForDropdown[0];

  const [dropdownPresetId, setDropdownPresetId] = useState<string>(
    defaultPreset ? String(defaultPreset.id) : "",
  );
  const [lastAppliedId, setLastAppliedId] = useState<string | null>(null);
  const [lastAppliedParams, setLastAppliedParams] =
    useState<Preset["base_params"] | null>(null);

  useEffect(() => {
    const dflt =
      library.presets.find(
        (p) => String(p.material_id) === dropdownMaterialId && p.is_default,
      ) ?? library.presets.find((p) => String(p.material_id) === dropdownMaterialId);
    setDropdownPresetId(dflt ? String(dflt.id) : "");
  }, [dropdownMaterialId, library.presets]);

  const selectedPreset = presetsForDropdown.find(
    (p) => String(p.id) === dropdownPresetId,
  );

  function doApply() {
    if (!selectedPreset) return;
    onApply(String(selectedPreset.material_id), { ...selectedPreset.base_params });
    setLastAppliedId(String(selectedPreset.id));
    setLastAppliedParams({ ...selectedPreset.base_params });
  }

  const status: "applied" | "modified" | "" = (() => {
    if (!lastAppliedId || !lastAppliedParams) return "";
    const a = lastAppliedParams as unknown as Record<string, unknown>;
    const b = baseParams as unknown as Record<string, unknown>;
    const matches = Object.keys(a).every((k) => a[k] === b[k]);
    return matches ? "applied" : "modified";
  })();

  if (library.materials.length === 0) {
    return (
      <div className="rounded-[6px] border border-dashed border-[color:var(--color-border-strong)] px-3 py-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
        No library yet — set up on the Library tab.
      </div>
    );
  }

  return (
    <Card variant="elevated" padded={false} className="p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Material">
          <Select
            value={dropdownMaterialId}
            onChange={(e) => setDropdownMaterialId(e.target.value)}
            className="min-w-[140px]"
          >
            {library.materials.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Preset">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded-[4px] shrink-0 border"
              style={{
                background: selectedPreset?.color ?? "transparent",
                borderColor: selectedPreset?.color
                  ? "var(--color-border-strong)"
                  : "var(--color-border)",
              }}
              title={selectedPreset?.color ?? "no colour set"}
            />
            <Select
              value={dropdownPresetId}
              onChange={(e) => setDropdownPresetId(e.target.value)}
              disabled={presetsForDropdown.length === 0}
              className="min-w-[160px]"
            >
              {presetsForDropdown.length === 0 && <option>No presets</option>}
              {presetsForDropdown.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                  {p.is_default ? " (default)" : ""}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Button
          variant="primary"
          size="sm"
          onClick={doApply}
          disabled={!selectedPreset}
        >
          Apply
        </Button>
        {status === "applied" && (
          <Badge variant="success" size="sm">
            <Check className="h-3 w-3" />
            Applied
          </Badge>
        )}
        {status === "modified" && (
          <Badge variant="warning" size="sm">
            Modified
          </Badge>
        )}
      </div>
    </Card>
  );
}
