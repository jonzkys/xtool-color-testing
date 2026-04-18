import { useEffect, useState } from "react";
import type { LibraryState, Preset } from "../library";

interface Props {
  library: LibraryState;
  materialId: string | null;
  baseParams: Preset["base_params"];
  onApply: (materialId: string, baseParams: Preset["base_params"]) => void;
}

/**
 * Material + preset dropdown with explicit Apply button.
 *
 * Shows a status indicator:
 *  - ✓ Applied  — when baseParams exactly matches the last-applied preset
 *  - Modified   — when the user has edited base_params since applying
 *  - (nothing)  — when no preset has been applied in this session yet
 */
export function MaterialPresetPicker({ library, materialId, baseParams, onApply }: Props) {
  const effectiveMaterialId = materialId ?? library.active_material_id ?? library.materials[0]?.id ?? "";
  const [dropdownMaterialId, setDropdownMaterialId] = useState<string>(effectiveMaterialId);

  const presetsForDropdown = library.presets.filter((p) => p.material_id === dropdownMaterialId);
  const defaultPreset = presetsForDropdown.find((p) => p.is_default) ?? presetsForDropdown[0];

  const [dropdownPresetId, setDropdownPresetId] = useState<string>(defaultPreset?.id ?? "");
  const [lastAppliedId, setLastAppliedId] = useState<string | null>(null);
  const [lastAppliedParams, setLastAppliedParams] = useState<Preset["base_params"] | null>(null);

  // Reset preset dropdown to the material's default when the material changes.
  useEffect(() => {
    const dflt = library.presets.find((p) => p.material_id === dropdownMaterialId && p.is_default)
               ?? library.presets.find((p) => p.material_id === dropdownMaterialId);
    setDropdownPresetId(dflt?.id ?? "");
  }, [dropdownMaterialId, library.presets]);

  const selectedPreset = presetsForDropdown.find((p) => p.id === dropdownPresetId);

  function doApply() {
    if (!selectedPreset) return;
    onApply(selectedPreset.material_id, { ...selectedPreset.base_params });
    setLastAppliedId(selectedPreset.id);
    setLastAppliedParams({ ...selectedPreset.base_params });
  }

  const status = (() => {
    if (!lastAppliedId || !lastAppliedParams) return "";
    const matches = Object.keys(lastAppliedParams).every(
      (k) => (lastAppliedParams as any)[k] === (baseParams as any)[k],
    );
    return matches ? "applied" : "modified";
  })();

  if (library.materials.length === 0) {
    return (
      <div style={{ padding: 8, border: "1px dashed #ccc", borderRadius: 4, fontSize: 12, color: "#888" }}>
        No library yet — set up in Library tab.
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 10, marginBottom: 12, background: "#fafafa" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Material</span>
          <select
            value={dropdownMaterialId}
            onChange={(e) => setDropdownMaterialId(e.target.value)}
            style={{ padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
          >
            {library.materials.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "block" }}>
          <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Preset</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden
              style={{
                width: 16, height: 16, borderRadius: 3,
                background: selectedPreset?.color ?? "transparent",
                border: "1px solid " + (selectedPreset?.color ? "#999" : "#ccc"),
                flexShrink: 0,
              }}
              title={selectedPreset?.color ?? "no color set"}
            />
            <select
              value={dropdownPresetId}
              onChange={(e) => setDropdownPresetId(e.target.value)}
              disabled={presetsForDropdown.length === 0}
              style={{ padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
            >
              {presetsForDropdown.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.color ? "● " : ""}{p.name}{p.is_default ? " (default)" : ""}
                </option>
              ))}
              {presetsForDropdown.length === 0 && <option>No presets</option>}
            </select>
          </div>
        </label>
        <button
          onClick={doApply}
          disabled={!selectedPreset}
          style={{ padding: "4px 10px", background: "#336", color: "white", border: "none", borderRadius: 4, cursor: selectedPreset ? "pointer" : "default", opacity: selectedPreset ? 1 : 0.5 }}
        >
          Apply
        </button>
        {status === "applied" && <span style={{ fontSize: 11, color: "#206030" }}>✓ Applied</span>}
        {status === "modified" && <span style={{ fontSize: 11, color: "#a05000" }}>Modified</span>}
      </div>
    </div>
  );
}
