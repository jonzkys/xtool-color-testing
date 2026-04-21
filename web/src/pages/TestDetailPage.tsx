import { useEffect, useState } from "react";
import type { Material, Preset } from "../library";
import type { TestRecord, TestSpec } from "../types";
import { getTest, updateTest, deleteTest, generateTestXcs, createTest } from "../api/tests";
import { listMaterials, listPresets } from "../api/library";
import { ParamTestEditor } from "../components/ParamTestEditor";
import { TestPreview } from "../components/TestPreview";
import { ResultsPanel } from "../components/ResultsPanel";
import { formatRoute } from "../router";
import { DEFAULT_SPEC } from "../defaults";
import { normalizeSpec } from "../specUtils";

interface Props {
  testId: number | "new";
}

export function TestDetailPage({ testId }: Props) {
  const [test, setTest] = useState<TestRecord | null>(null);
  const [spec, setSpec] = useState<TestSpec>(DEFAULT_SPEC);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [, setPresets] = useState<Preset[]>([]);
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [name, setName] = useState("New test");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([listMaterials(), listPresets()]);
      setMaterials(m); setPresets(p);
      if (testId !== "new") {
        const t = await getTest(testId);
        setTest(t);
        setSpec(t.spec); setName(t.name); setMaterialId(t.material_id);
      } else {
        const firstMid = m[0]?.id ?? null;
        setMaterialId(firstMid);
        const preset = firstMid ? p.find(q => q.material_id === firstMid && q.is_default) : null;
        if (preset) setSpec(s => ({ ...s, base_params: preset.base_params }));
      }
    })().catch(e => setError((e as Error).message));
  }, [testId]);

  async function onSave() {
    if (materialId === null) { setError("Pick a material"); return; }
    setSaving(true); setError(undefined);
    try {
      const normalized = normalizeSpec(spec);
      if (normalized !== spec) setSpec(normalized);
      if (test) {
        const updated = await updateTest(test.id, test.locked ? { name } : { name, spec: normalized });
        setTest(updated);
      } else {
        const created = await createTest({ name, material_id: materialId, spec: normalized });
        window.location.hash = formatRoute({ name: "test-detail", id: created.id });
      }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function onDelete() {
    if (!test) return;
    if (!confirm(`Delete test #${test.id}?`)) return;
    await deleteTest(test.id);
    window.location.hash = formatRoute({ name: "tests" });
  }

  async function onDuplicate() {
    if (materialId === null) return;
    const copy = await createTest({ name: `${name} (copy)`, material_id: materialId, spec: normalizeSpec(spec) });
    window.location.hash = formatRoute({ name: "test-detail", id: copy.id });
  }

  async function onGenerate() {
    if (!test) return;
    setError(undefined);
    try {
      if (!test.locked) {
        const normalized = normalizeSpec(spec);
        if (normalized !== spec) setSpec(normalized);
        const updated = await updateTest(test.id, { name, spec: normalized });
        setTest(updated);
      }
      const blob = await generateTestXcs(test.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${test.name || `test-${test.id}`}.xcs`;
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "minmax(320px, 360px) 1fr minmax(320px, 400px)",
      height: "100%", minHeight: 0,
    }}>
      <div style={{ overflow: "auto", borderRight: "1px solid #ddd" }}>
        <div style={{ padding: 12 }}>
          <input value={name} onChange={e => setName(e.target.value)}
                 style={{ width: "100%", fontSize: 18, padding: 6, marginBottom: 8 }} />
          {test && (
            <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
              #{test.id} · {test.status}{test.locked ? " · locked" : ""}
            </div>
          )}
          <label style={{ display: "block", marginBottom: 8, fontSize: 12 }}>
            Material
            <select value={materialId ?? ""} disabled={!!test}
                    onChange={e => setMaterialId(Number(e.target.value))}
                    style={{ width: "100%", padding: 4 }}>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          {error && <div style={{ color: "#a02840", fontSize: 12, marginBottom: 8 }}>{error}</div>}
        </div>
        <ParamTestEditor spec={spec} onChange={setSpec} locked={test?.locked ?? false} />
        <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onSave} disabled={saving}>
            {test ? (test.locked ? "Save name/notes" : "Save") : "Create"}
          </button>
          {test && <button onClick={onGenerate}>Generate .xcs</button>}
          {test && <button onClick={onDuplicate}>Duplicate as new</button>}
          {test && <button onClick={onDelete} style={{ color: "#a02840" }}>Delete</button>}
        </div>
      </div>

      <div style={{ overflow: "auto", padding: 12, borderRight: "1px solid #ddd" }}>
        <TestPreview spec={spec} testId={test?.id ?? null} />
      </div>

      <div style={{ overflow: "auto" }}>
        {test ? <ResultsPanel testId={test.id} locked={test.locked} /> : (
          <div style={{ padding: 24, color: "#888" }}>Save the test to upload results.</div>
        )}
      </div>
    </div>
  );
}
