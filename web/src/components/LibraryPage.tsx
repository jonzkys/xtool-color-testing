import { useState } from "react";
import { defaultBaseParams } from "../defaults";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import type { LibraryState, Preset } from "../library";
import {
  addMaterial, addPreset, deleteMaterial, deletePreset,
  renameMaterial, setActiveMaterial, setDefaultPreset, updatePreset,
} from "../library";

interface Props {
  library: LibraryState;
  onChange: (next: LibraryState) => void;
}

export function LibraryPage({ library, onChange }: Props) {
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(
    library.active_material_id || library.materials[0]?.id || "",
  );
  const selectedMaterial = library.materials.find((m) => m.id === selectedMaterialId);
  const presets = library.presets.filter((p) => p.material_id === selectedMaterialId);

  function onAddMaterial() {
    const name = prompt("Material name?", "Untitled material");
    if (!name) return;
    const next = addMaterial(library, name);
    onChange(next);
    setSelectedMaterialId(next.materials[next.materials.length - 1].id);
  }

  function onDeleteMaterial(id: string) {
    const m = library.materials.find((mm) => mm.id === id);
    if (!m) return;
    const hasPresets = library.presets.some((p) => p.material_id === id);
    if (hasPresets) {
      alert(`Cannot delete "${m.name}" — delete its presets first.`);
      return;
    }
    if (!confirm(`Delete material "${m.name}"?`)) return;
    const next = deleteMaterial(library, id);
    onChange(next);
    if (selectedMaterialId === id) {
      setSelectedMaterialId(next.materials[0]?.id ?? "");
    }
  }

  function onRenameMaterial(id: string) {
    const m = library.materials.find((mm) => mm.id === id);
    if (!m) return;
    const name = prompt("New name?", m.name);
    if (!name || name === m.name) return;
    onChange(renameMaterial(library, id, name));
  }

  function onSetActive(id: string) {
    onChange(setActiveMaterial(library, id));
  }

  function onAddPreset() {
    if (!selectedMaterial) return;
    const existingDefault = library.presets.find(
      (p) => p.material_id === selectedMaterial.id && p.is_default,
    );
    const seed = existingDefault ? existingDefault.base_params : defaultBaseParams();
    const next = addPreset(library, selectedMaterial.id, {
      name: "Untitled preset",
      base_params: { ...seed },
    });
    onChange(next);
  }

  function onUpdatePreset(id: string, patch: Partial<Pick<Preset, "name" | "color" | "base_params">>) {
    onChange(updatePreset(library, id, patch));
  }

  function onDeletePreset(id: string) {
    const p = library.presets.find((pp) => pp.id === id);
    if (!p) return;
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    onChange(deletePreset(library, id));
  }

  function onSetDefault(id: string) {
    onChange(setDefaultPreset(library, id));
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100%", minHeight: 0 }}>
      <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto", padding: 12 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
          Materials
        </div>
        {library.materials.map((m) => {
          const presetCount = library.presets.filter((p) => p.material_id === m.id).length;
          const isActive = m.id === library.active_material_id;
          const isSelected = m.id === selectedMaterialId;
          return (
            <div
              key={m.id}
              onClick={() => setSelectedMaterialId(m.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", marginBottom: 4, borderRadius: 4,
                cursor: "pointer",
                background: isSelected ? "#e8ecf3" : "transparent",
                border: "1px solid " + (isSelected ? "#336" : "transparent"),
              }}
            >
              <div style={{ flex: 1, fontSize: 13 }}>
                {m.name} {isActive && <span style={{ color: "#206030", fontSize: 10 }}>(active)</span>}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>{presetCount}</div>
              <button
                onClick={(e) => { e.stopPropagation(); onRenameMaterial(m.id); }}
                style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: "pointer" }}
              >
                rename
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onSetActive(m.id); }}
                disabled={isActive}
                style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: isActive ? "default" : "pointer", opacity: isActive ? 0.5 : 1 }}
              >
                set active
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteMaterial(m.id); }}
                style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: "pointer", color: "#a02840" }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          onClick={onAddMaterial}
          style={{ marginTop: 8, width: "100%", padding: "6px", background: "#e8ecf3", border: "1px dashed #336", borderRadius: 4, color: "#336", cursor: "pointer" }}
        >
          + New material
        </button>
      </div>

      <div style={{ padding: 16, overflow: "auto" }}>
        {selectedMaterial ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>{selectedMaterial.name}</h2>
              <button
                onClick={onAddPreset}
                style={{ padding: "6px 12px", background: "#336", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
              >
                + New preset
              </button>
            </div>
            {presets.length === 0 ? (
              <div style={{ color: "#888" }}>No presets yet. Click "+ New preset" to add one.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {presets.map((p) => (
                  <PresetCard
                    key={p.id}
                    preset={p}
                    onPatch={(patch) => onUpdatePreset(p.id, patch)}
                    onSetDefault={() => onSetDefault(p.id)}
                    onDelete={() => onDeletePreset(p.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#888" }}>Select a material on the left, or add a new one.</div>
        )}
      </div>
    </div>
  );
}

function PresetCard({
  preset, onPatch, onSetDefault, onDelete,
}: {
  preset: Preset;
  onPatch: (patch: Partial<Pick<Preset, "name" | "color" | "base_params">>) => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 12, background: "white" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={preset.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ flex: 1, padding: "4px 6px", fontSize: 14, fontWeight: 600, border: "1px solid transparent", borderRadius: 3 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          <input
            type="radio"
            checked={preset.is_default}
            onChange={onSetDefault}
          />
          default
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input
          type="color"
          value={preset.color ?? "#888888"}
          onChange={(e) => onPatch({ color: e.target.value })}
          style={{ width: 32, height: 28, border: "1px solid #ccc", borderRadius: 3 }}
        />
        <div style={{ fontSize: 11, fontFamily: "monospace", color: "#555" }}>
          {preset.color ?? "(none)"}
        </div>
        {preset.color && (
          <button
            onClick={() => onPatch({ color: undefined })}
            style={{ fontSize: 10, padding: "2px 4px", border: "1px solid #ddd", background: "white", borderRadius: 3, cursor: "pointer" }}
          >
            clear
          </button>
        )}
      </div>
      <NumberField label="Power %" value={preset.base_params.power} onChange={(v) => onPatch({ base_params: { ...preset.base_params, power: v } })} />
      <NumberField label="Speed" value={preset.base_params.speed} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, speed: v } })} />
      <NumberField label="Frequency" value={preset.base_params.frequency} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, frequency: v } })} />
      <NumberField label="Lines/cm" value={preset.base_params.density} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, density: v } })} />
      <NumberField label="Passes" value={preset.base_params.passes} integer min={1} onChange={(v) => onPatch({ base_params: { ...preset.base_params, passes: v } })} />
      <NumberField label="Pulse width" value={preset.base_params.pulse_width} integer onChange={(v) => onPatch({ base_params: { ...preset.base_params, pulse_width: v } })} />
      <SelectField
        label="Laser"
        value={preset.base_params.laser}
        options={[{ value: "red", label: "Red (MOPA)" }, { value: "blue", label: "Blue (diode)" }]}
        onChange={(v) => onPatch({ base_params: { ...preset.base_params, laser: v as "red" | "blue" } })}
      />
      <div style={{ marginTop: 8, textAlign: "right" }}>
        <button
          onClick={onDelete}
          style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #ddd", background: "white", borderRadius: 3, color: "#a02840", cursor: "pointer" }}
        >
          Delete preset
        </button>
      </div>
    </div>
  );
}
