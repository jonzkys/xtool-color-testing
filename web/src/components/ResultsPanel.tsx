import { useEffect, useState } from "react";
import type { AveragedSwatch, ResultRecord } from "../types";
import {
  listResults, uploadResult, patchResult, deleteResult,
  getAveragedSwatches, ingestToPalette,
} from "../api/results";

const SIGMA_WARN = 10;

export function ResultsPanel({ testId, locked: _locked }: { testId: number; locked: boolean }) {
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [averaged, setAveragedSwatches] = useState<AveragedSwatch[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [mode, setMode] = useState<"averaged" | "single_result">("averaged");
  const [sourceResultId, setSourceResultId] = useState<number | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);

  async function refresh() {
    try {
      const [r, a] = await Promise.all([listResults(testId), getAveragedSwatches(testId)]);
      setResults(r); setAveragedSwatches(a);
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { refresh(); }, [testId]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setBusy(true); setError(undefined);
    try { await uploadResult(testId, file); await refresh(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); e.target.value = ""; }
  }

  async function toggleExclude(rid: number, excluded: boolean) {
    await patchResult(rid, { excluded }); await refresh();
  }

  async function onDeleteResult(rid: number) {
    if (!confirm("Delete this result?")) return;
    await deleteResult(rid); await refresh();
  }

  const indices = Object.entries(selected).filter(([, v]) => v).map(([k]) => Number(k));
  async function doIngest() {
    if (indices.length === 0) return;
    try {
      await ingestToPalette(testId, {
        swatch_indices: indices,
        mode,
        result_id: mode === "single_result" && sourceResultId !== null ? sourceResultId : undefined,
        replace_existing: replaceExisting,
      });
      setSelected({}); setReplaceExisting(false);
      alert("Ingested.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <label style={{
        display: "inline-block", padding: "8px 16px", background: "#336", color: "white",
        borderRadius: 4, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
      }}>
        {busy ? "Uploading..." : "Upload photo"}
        <input type="file" accept="image/*" capture="environment"
               disabled={busy} onChange={onUpload} style={{ display: "none" }} />
      </label>
      {error && <div style={{ color: "#a02840", fontSize: 12, marginTop: 8 }}>{error}</div>}

      <h3 style={{ marginTop: 20, fontSize: 13 }}>Results ({results.length})</h3>
      {results.map(r => (
        <div key={r.id} style={{
          border: "1px solid #ddd", borderRadius: 4, marginBottom: 8, padding: 8,
          opacity: r.excluded ? 0.5 : 1,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src={r.image_url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4 }} />
            <div style={{ fontSize: 12, flex: 1 }}>
              <div>#{r.id} · {new Date(r.uploaded_at).toLocaleString()}</div>
              <div style={{ color: "#666" }}>
                {r.swatches.length} swatches · max σ {Math.max(...r.swatches.map(s => s.sigma), 0).toFixed(1)}
              </div>
            </div>
            <label style={{ fontSize: 11 }}>
              <input type="checkbox" checked={r.excluded}
                     onChange={e => toggleExclude(r.id, e.target.checked)} />
              exclude
            </label>
            <button onClick={() => onDeleteResult(r.id)} style={{ color: "#a02840" }}>✕</button>
          </div>
        </div>
      ))}

      <h3 style={{ marginTop: 20, fontSize: 13 }}>Averaged swatches</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: 4 }}>
        {averaged.map((s, i) => {
          const unavailable = s.sample_count === 0;
          return (
            <div key={i} onClick={() => !unavailable && setSelected(p => ({ ...p, [i]: !p[i] }))}
                 style={{
                   border: selected[i] ? "2px solid #336" : unavailable ? "1px dashed #aaa" : "1px solid #ccc",
                   padding: 3, cursor: unavailable ? "default" : "pointer",
                   opacity: unavailable ? 0.4 : 1,
                 }}>
              <div style={{ background: s.hex, height: 30, borderRadius: 2 }} />
              <div style={{ fontSize: 9, fontFamily: "monospace" }}>{s.hex}</div>
              <div style={{ fontSize: 9, color: s.sigma >= SIGMA_WARN ? "#a05000" : "#666" }}>
                n={s.sample_count} σ={s.sigma.toFixed(1)}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, padding: 8, border: "1px solid #eee", borderRadius: 4 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }}>
          Ingest {indices.length} swatch{indices.length === 1 ? "" : "es"} to palette
        </div>
        <label style={{ fontSize: 11, marginRight: 8 }}>
          <input type="radio" name="mode" checked={mode === "averaged"} onChange={() => setMode("averaged")} />
          averaged
        </label>
        <label style={{ fontSize: 11, marginRight: 8 }}>
          <input type="radio" name="mode" checked={mode === "single_result"}
                 onChange={() => setMode("single_result")} />
          from specific result
        </label>
        {mode === "single_result" && (
          <select value={sourceResultId ?? ""} onChange={e => setSourceResultId(Number(e.target.value))}
                  style={{ fontSize: 11, marginLeft: 4 }}>
            <option value="">— pick —</option>
            {results.filter(r => !r.excluded).map(r => (
              <option key={r.id} value={r.id}>#{r.id}</option>
            ))}
          </select>
        )}
        <label style={{ fontSize: 11, marginLeft: 8 }}>
          <input type="checkbox" checked={replaceExisting}
                 onChange={e => setReplaceExisting(e.target.checked)} />
          replace existing
        </label>
        <br />
        <button onClick={doIngest} disabled={indices.length === 0}
                style={{ marginTop: 6 }}>
          Ingest to palette
        </button>
      </div>
    </div>
  );
}
