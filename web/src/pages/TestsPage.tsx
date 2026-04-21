import { useEffect, useState } from "react";
import type { Material, Preset } from "../library";
import type { TestRecord } from "../types";
import { listTests, createTest } from "../api/tests";
import { listMaterials, listPresets } from "../api/library";
import { formatRoute } from "../router";
import { DEFAULT_SPEC } from "../defaults";
import { normalizeSpec } from "../specUtils";

export function TestsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tests, setTests] = useState<TestRecord[]>([]);
  const [materialId, setMaterialId] = useState<number | undefined>();
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>();

  async function refresh() {
    try {
      const [m, p, t] = await Promise.all([
        listMaterials(), listPresets(),
        listTests({ material_id: materialId, status: status || undefined }),
      ]);
      setMaterials(m); setPresets(p); setTests(t);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { refresh(); }, [materialId, status]);  // eslint-disable-line

  async function onNew() {
    if (materials.length === 0) {
      setError("Create a material on the Library tab first.");
      return;
    }
    const mid = materialId ?? materials[0].id;
    const preset = presets.find(p => p.material_id === mid && p.is_default);
    const spec = normalizeSpec({ ...DEFAULT_SPEC, base_params: preset?.base_params ?? DEFAULT_SPEC.base_params });
    const t = await createTest({ name: "New test", material_id: mid, spec });
    window.location.hash = formatRoute({ name: "test-detail", id: t.id });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100%" }}>
      <div style={{ borderRight: "1px solid #ddd", padding: 12, overflow: "auto" }}>
        <button onClick={onNew} style={{ width: "100%", padding: "8px 12px", marginBottom: 12 }}>
          + New test
        </button>
        <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 4 }}>
          Material
          <select value={materialId ?? ""} onChange={e =>
            setMaterialId(e.target.value ? Number(e.target.value) : undefined)
          } style={{ width: "100%", padding: 4 }}>
            <option value="">— all —</option>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: "#666", display: "block", marginBottom: 12 }}>
          Status
          <select value={status} onChange={e => setStatus(e.target.value)}
                  style={{ width: "100%", padding: 4 }}>
            <option value="">not deleted</option>
            <option value="created">created</option>
            <option value="tested">tested</option>
            <option value="deleted">deleted</option>
          </select>
        </label>

        {error && <div style={{ color: "#a02840", fontSize: 12 }}>{error}</div>}

        {tests.map(t => (
          <a key={t.id}
             href={formatRoute({ name: "test-detail", id: t.id })}
             style={{
               display: "block", padding: "8px 6px",
               borderBottom: "1px solid #eee", color: "#222",
               textDecoration: "none",
             }}>
            <div style={{ fontWeight: 500 }}>#{t.id} {t.name}</div>
            <div style={{ fontSize: 11, color: "#666" }}>
              {t.status}{t.locked ? " · 🔒" : ""} · {materials.find(m => m.id === t.material_id)?.name ?? "?"}
            </div>
          </a>
        ))}
        {tests.length === 0 && !error && (
          <div style={{ color: "#888", fontSize: 12, padding: 8 }}>No tests match.</div>
        )}
      </div>
      <div style={{ padding: 24, color: "#888" }}>
        Pick a test from the list, or click "New test".
      </div>
    </div>
  );
}
