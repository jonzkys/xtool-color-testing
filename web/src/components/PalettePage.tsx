import { useEffect, useMemo, useState } from "react";
import {
  captureIngest, paletteDelete, paletteDeleteByTest,
  paletteIngest, paletteList, paletteQuery,
} from "../palette-api";
import type {
  CaptureIngestResponse, CaptureSwatch, PaletteEntry, PaletteQueryResult,
} from "../types";
import type { LibraryState } from "../library";

const SIGMA_WARN = 10;

type View = "upload" | "query" | "browse";

interface Props {
  library: LibraryState;
}

export function PalettePage({ library }: Props) {
  const [view, setView] = useState<View>("upload");

  if (library.materials.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 12, border: "1px dashed #ccc", borderRadius: 4, color: "#888" }}>
          No materials defined. Add one on the Library tab first — palette
          entries must be tagged with a material so queries can be scoped.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <SubTab active={view === "upload"} onClick={() => setView("upload")}>Upload</SubTab>
        <SubTab active={view === "query"} onClick={() => setView("query")}>Query</SubTab>
        <SubTab active={view === "browse"} onClick={() => setView("browse")}>Browse</SubTab>
      </div>
      {view === "upload" && <UploadView library={library} />}
      {view === "query" && <QueryView library={library} />}
      {view === "browse" && <BrowseView library={library} />}
    </div>
  );
}

function SubTab({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px",
      border: "1px solid " + (active ? "#336" : "#ddd"),
      background: active ? "#e8ecf3" : "white",
      color: active ? "#336" : "#555",
      borderRadius: 4, fontWeight: active ? 600 : 400, cursor: "pointer",
      fontSize: 13,
    }}>
      {children}
    </button>
  );
}

function MaterialSelect({ library, value, onChange, required, label }: {
  library: LibraryState;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  label?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
      {label && <span style={{ color: "#555" }}>{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 8px",
          border: `1px solid ${required && !value ? "#a02840" : "#ccc"}`,
          borderRadius: 4, background: "white", font: "inherit",
        }}
      >
        {!required && <option value="">— all materials —</option>}
        {required && !value && <option value="">— pick a material —</option>}
        {library.materials.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </label>
  );
}

function UploadView({ library }: { library: LibraryState }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [response, setResponse] = useState<CaptureIngestResponse | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | undefined>();
  const [materialId, setMaterialId] = useState<string>("");

  const qrProvidedMaterial = response?.material_id ?? null;
  const qrMaterialKnown = qrProvidedMaterial
    ? library.materials.some((m) => m.id === qrProvidedMaterial)
    : false;
  const needsManualMaterial = !!response && !qrMaterialKnown;

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    setSaveResult(undefined);
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setResponse(null);
    try {
      const r = await captureIngest(file);
      setResponse(r);
      // Pre-select the material if the QR carried a known one, otherwise
      // fall back to the library's active material as a suggestion.
      const known = r.material_id && library.materials.some((m) => m.id === r.material_id);
      setMaterialId(known ? r.material_id! : (library.active_material_id || ""));
      const initial: Record<number, boolean> = {};
      r.swatches.forEach((s, i) => {
        initial[i] = s.sigma < SIGMA_WARN;
      });
      setSelected(initial);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  async function onSave() {
    if (!response || !materialId) return;
    const toSave = response.swatches.filter((_, i) => selected[i]);
    if (toSave.length === 0) return;
    setSaving(true);
    try {
      const r = await paletteIngest({
        test_id: response.test_id,
        material_id: materialId,
        x_param: response.x_param,
        y_param: response.y_param,
        base_params: response.base_params,
        swatches: toSave,
      });
      setSaveResult(`Saved ${r.added_ids.length} swatches to palette.`);
      setResponse(null);
      setSelected({});
      setMaterialId("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const canSave = !!response && !!materialId && selectedCount > 0 && !saving;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Upload burned test photo</h2>
      <p style={{ color: "#555", maxWidth: 620, marginTop: 0 }}>
        Take a roughly top-down photo of a burned registration sheet. The QR code
        carries the test's base parameters — each detected cell becomes a swatch
        you can save to the palette for the material it was burned on.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: "inline-block", padding: "8px 16px",
          background: "#336", color: "white", borderRadius: 4,
          cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1,
        }}>
          {loading ? "Processing..." : "Select photo"}
          <input
            type="file" accept="image/*" capture="environment"
            disabled={loading} onChange={onUpload}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {error && (
        <div style={{ color: "#a02840", marginBottom: 12, padding: 8, background: "#fee", border: "1px solid #fbb", borderRadius: 4 }}>
          {error}
        </div>
      )}
      {saveResult && (
        <div style={{ color: "#206030", marginBottom: 12, padding: 8, background: "#efe", border: "1px solid #bfb", borderRadius: 4 }}>
          {saveResult}
        </div>
      )}

      {response && (
        <div>
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <strong>Detected:</strong> test <code>{response.test_id}</code> ({response.kind}),
            varying <code>{response.x_param}</code>
            {response.y_param ? <> × <code>{response.y_param}</code></> : null}
            , {response.swatches.length} cells
          </div>

          <div style={{ marginBottom: 12, padding: 10, background: "#fafafa", border: "1px solid #ddd", borderRadius: 4 }}>
            <MaterialSelect
              library={library}
              value={materialId}
              onChange={setMaterialId}
              required
              label="Material:"
            />
            {needsManualMaterial && (
              <div style={{ fontSize: 12, color: "#a05000", marginTop: 6 }}>
                ⚠ The QR didn't carry a known material tag — pick one before saving.
              </div>
            )}
            {qrMaterialKnown && (
              <div style={{ fontSize: 12, color: "#206030", marginTop: 6 }}>
                ✓ Material resolved from the QR tag.
              </div>
            )}
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
            gap: 8, marginBottom: 16,
          }}>
            {response.swatches.map((s, i) => (
              <SwatchCard
                key={i}
                swatch={s}
                selected={!!selected[i]}
                onToggle={() => setSelected(prev => ({ ...prev, [i]: !prev[i] }))}
              />
            ))}
          </div>
          <button
            onClick={onSave}
            disabled={!canSave}
            style={{
              padding: "8px 16px",
              background: !canSave ? "#ccc" : "#336",
              color: "white", border: "none", borderRadius: 4, fontWeight: 600,
              cursor: !canSave ? "default" : "pointer",
            }}
          >
            {saving ? "Saving..."
              : selectedCount === 0 ? "Select at least one swatch"
              : !materialId ? "Pick a material to save"
              : `Save ${selectedCount} swatch${selectedCount === 1 ? "" : "es"} to palette`}
          </button>
        </div>
      )}
    </div>
  );
}

function SwatchCard({ swatch, selected, onToggle }: {
  swatch: CaptureSwatch;
  selected: boolean;
  onToggle: () => void;
}) {
  const noisy = swatch.sigma >= SIGMA_WARN;
  return (
    <div
      onClick={onToggle}
      title={noisy ? "High sigma — probably noisy/edge" : undefined}
      style={{
        border: selected ? "2px solid #336" : "1px solid #ccc",
        borderRadius: 4, padding: 4, cursor: "pointer",
        opacity: selected ? 1 : 0.5, background: "white",
      }}
    >
      <div style={{ background: swatch.hex, height: 42, borderRadius: 2 }} />
      <div style={{ fontSize: 10, marginTop: 4, fontFamily: "monospace" }}>
        {swatch.hex}
      </div>
      <div style={{ fontSize: 10, color: noisy ? "#a05000" : "#666" }}>
        {noisy && "⚠ "}σ={swatch.sigma.toFixed(1)}
      </div>
      <div style={{ fontSize: 9, color: "#888" }}>
        x={swatch.x_value}
        {swatch.y_value !== null && <> y={swatch.y_value}</>}
      </div>
    </div>
  );
}

function QueryView({ library }: { library: LibraryState }) {
  const [hex, setHex] = useState("#c4a87b");
  const [materialId, setMaterialId] = useState<string>(library.active_material_id || "");
  const [results, setResults] = useState<PaletteQueryResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onQuery() {
    setError(undefined);
    try {
      const r = await paletteQuery(hex, 5, materialId || undefined);
      setResults(r);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Find closest-matching params</h2>
      <p style={{ color: "#555", marginTop: 0 }}>
        Pick a target colour — we'll return the 5 nearest palette entries by CIEDE2000.
        Scope by material to avoid mixing burn families.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="color" value={hex} onChange={(e) => setHex(e.target.value)}
          style={{ width: 48, height: 36, border: "1px solid #ccc", borderRadius: 4 }}
        />
        <input
          type="text" value={hex} onChange={(e) => setHex(e.target.value)}
          style={{ width: 120, padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, fontFamily: "monospace" }}
        />
        <MaterialSelect library={library} value={materialId} onChange={setMaterialId} label="Scope:" />
        <button onClick={onQuery} style={{
          padding: "8px 16px", background: "#336", color: "white",
          border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer",
        }}>
          Find closest
        </button>
      </div>
      {error && <div style={{ color: "#a02840", marginBottom: 12 }}>{error}</div>}
      {searched && results.length === 0 && (
        <div style={{ color: "#888" }}>
          No entries match. Either the palette is empty or there are no
          entries for the selected material.
        </div>
      )}
      <div>
        {results.map((r) => (
          <ResultRow key={r.entry.id} result={r} library={library} />
        ))}
      </div>
    </div>
  );
}

function ResultRow({ result, library }: { result: PaletteQueryResult; library: LibraryState }) {
  const p = result.entry.params;
  const materialName = library.materials.find((m) => m.id === result.entry.material_id)?.name
    ?? "(unknown material)";
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "center", padding: "10px 0",
      borderBottom: "1px solid #eee",
    }}>
      <div style={{
        width: 48, height: 48, background: result.entry.hex, borderRadius: 4,
        border: "1px solid #ddd", flexShrink: 0,
      }} />
      <div style={{ fontFamily: "monospace", width: 80 }}>{result.entry.hex}</div>
      <div style={{ width: 90, fontSize: 13 }}>ΔE = {result.delta_e.toFixed(2)}</div>
      <div style={{ width: 120, fontSize: 12, color: "#555" }}>{materialName}</div>
      <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>
        P={p.power}% S={p.speed} F={p.frequency} D={p.density} ×{p.passes} PW={p.pulse_width} {p.laser}
      </div>
    </div>
  );
}

function BrowseView({ library }: { library: LibraryState }) {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [materialId, setMaterialId] = useState<string>("");
  const [error, setError] = useState<string | undefined>();
  const [infoId, setInfoId] = useState<string | null>(null);

  async function refresh() {
    setError(undefined);
    try {
      setEntries(await paletteList(materialId || undefined));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { refresh(); }, [materialId]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function onDelete(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    if (!confirm(`Delete the ${entry.hex} swatch from test ${entry.test_id}?`)) return;
    try { await paletteDelete(id); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }
  async function onDeleteTest(testId: string) {
    const count = entries.filter((e) => e.test_id === testId).length;
    if (!confirm(`Delete all ${count} palette entries from test "${testId}"?`)) return;
    try { await paletteDeleteByTest(testId); await refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  const byTest: Record<string, PaletteEntry[]> = {};
  entries.forEach((e) => {
    (byTest[e.test_id] = byTest[e.test_id] ?? []).push(e);
  });

  const infoEntry = useMemo(
    () => (infoId ? entries.find((e) => e.id === infoId) ?? null : null),
    [infoId, entries],
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Palette ({entries.length} entries)</h2>
        <MaterialSelect library={library} value={materialId} onChange={setMaterialId} label="Material:" />
      </div>
      {error && <div style={{ color: "#a02840", marginBottom: 12 }}>{error}</div>}
      {entries.length === 0 && !error && (
        <div style={{ color: "#888" }}>
          {materialId ? "No entries for this material yet." : "Empty — upload a burned test photo to populate."}
        </div>
      )}
      {Object.entries(byTest).map(([testId, group]) => {
        const materialName = library.materials.find((m) => m.id === group[0]?.material_id)?.name
          ?? (group[0]?.material_id ? "(unknown material)" : "(no material tag)");
        return (
          <div key={testId} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>Test <code>{testId}</code></h3>
              <span style={{ fontSize: 11, color: "#666" }}>· {materialName}</span>
              <button
                onClick={() => onDeleteTest(testId)}
                style={{
                  fontSize: 12, color: "#a02840", background: "none",
                  border: "1px solid #e0c0c8", borderRadius: 3, padding: "2px 6px", cursor: "pointer",
                }}
              >
                Delete all ({group.length})
              </button>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
              gap: 6,
            }}>
              {group.map((e) => (
                <EntryCard
                  key={e.id} entry={e}
                  onDelete={() => onDelete(e.id)}
                  onInfo={() => setInfoId(e.id)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {infoEntry && (
        <InfoModal entry={infoEntry} library={library} onClose={() => setInfoId(null)} />
      )}
    </div>
  );
}

function EntryCard({ entry, onDelete, onInfo }: {
  entry: PaletteEntry;
  onDelete: () => void;
  onInfo: () => void;
}) {
  return (
    <div style={{ border: "1px solid #ddd", padding: 4, borderRadius: 4, background: "white" }}>
      <div style={{ background: entry.hex, height: 40, borderRadius: 2, border: "1px solid #ccc" }} />
      <div style={{ fontSize: 10, fontFamily: "monospace", marginTop: 2 }}>{entry.hex}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <button onClick={onInfo} title="Show full params" style={{
          fontSize: 10, padding: "1px 5px", background: "none",
          border: "1px solid #ddd", borderRadius: 2, cursor: "pointer", color: "#336",
        }}>
          i
        </button>
        <button onClick={onDelete} style={{
          fontSize: 10, color: "#a02840", padding: 0, background: "none",
          border: "none", cursor: "pointer",
        }}>
          delete
        </button>
      </div>
    </div>
  );
}

function InfoModal({ entry, library, onClose }: {
  entry: PaletteEntry;
  library: LibraryState;
  onClose: () => void;
}) {
  const materialName = library.materials.find((m) => m.id === entry.material_id)?.name
    ?? (entry.material_id ? "(unknown material)" : "(no material tag)");
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 6, padding: 20, minWidth: 360, maxWidth: 520,
          boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ width: 56, height: 56, background: entry.hex, borderRadius: 4, border: "1px solid #ccc" }} />
          <div>
            <div style={{ fontFamily: "monospace", fontSize: 15 }}>{entry.hex}</div>
            <div style={{ fontSize: 12, color: "#666" }}>σ = {entry.sigma.toFixed(2)}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            fontSize: 14, padding: "4px 10px", border: "1px solid #ccc",
            background: "white", borderRadius: 4, cursor: "pointer",
          }}>Close</button>
        </div>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <tbody>
            <Row label="Material" value={materialName} />
            <Row label="Test" value={entry.test_id} mono />
            <Row label="Source" value={entry.source} />
            <Row label="Captured" value={entry.timestamp} mono />
            {Object.entries(entry.params).map(([k, v]) => (
              <Row key={k} label={k} value={String(v)} mono />
            ))}
            {entry.notes && <Row label="Notes" value={entry.notes} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr style={{ borderBottom: "1px solid #f0f0f0" }}>
      <td style={{ padding: "4px 8px 4px 0", color: "#666", width: 120 }}>{label}</td>
      <td style={{ padding: "4px 0", fontFamily: mono ? "monospace" : "inherit" }}>{value}</td>
    </tr>
  );
}
