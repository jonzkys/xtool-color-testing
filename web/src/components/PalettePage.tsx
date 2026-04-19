import { useEffect, useState } from "react";
import {
  captureIngest, paletteDelete, paletteDeleteByTest,
  paletteIngest, paletteList, paletteQuery,
} from "../palette-api";
import type {
  CaptureIngestResponse, CaptureSwatch, PaletteEntry, PaletteQueryResult,
} from "../types";

const SIGMA_WARN = 10;

type View = "upload" | "query" | "browse";

export function PalettePage() {
  const [view, setView] = useState<View>("upload");
  return (
    <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <SubTab active={view === "upload"} onClick={() => setView("upload")}>Upload</SubTab>
        <SubTab active={view === "query"} onClick={() => setView("query")}>Query</SubTab>
        <SubTab active={view === "browse"} onClick={() => setView("browse")}>Browse</SubTab>
      </div>
      {view === "upload" && <UploadView />}
      {view === "query" && <QueryView />}
      {view === "browse" && <BrowseView />}
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

function UploadView() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [response, setResponse] = useState<CaptureIngestResponse | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | undefined>();

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
    if (!response) return;
    const toSave = response.swatches.filter((_, i) => selected[i]);
    if (toSave.length === 0) return;
    setSaving(true);
    try {
      const r = await paletteIngest({
        test_id: response.test_id,
        x_param: response.x_param,
        y_param: response.y_param,
        base_params: response.base_params,
        swatches: toSave,
      });
      setSaveResult(`Saved ${r.added_ids.length} swatches to palette.`);
      setResponse(null);
      setSelected({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Upload burned test photo</h2>
      <p style={{ color: "#555", maxWidth: 600, marginTop: 0 }}>
        Take a roughly top-down photo of a burned registration sheet. The QR code
        carries the test's base parameters — each detected cell becomes a swatch
        you can save.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: "inline-block", padding: "8px 16px",
          background: "#336", color: "white", borderRadius: 4,
          cursor: loading ? "wait" : "pointer", opacity: loading ? 0.7 : 1,
        }}>
          {loading ? "Processing..." : "Select photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={loading}
            onChange={onUpload}
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
          <div style={{ marginBottom: 8, fontSize: 13 }}>
            <strong>Detected:</strong> test <code>{response.test_id}</code> ({response.kind}),
            varying <code>{response.x_param}</code>
            {response.y_param ? <> × <code>{response.y_param}</code></> : null}
            , {response.swatches.length} cells
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
            disabled={selectedCount === 0 || saving}
            style={{
              padding: "8px 16px",
              background: selectedCount === 0 || saving ? "#ccc" : "#336",
              color: "white", border: "none", borderRadius: 4, fontWeight: 600,
              cursor: selectedCount === 0 || saving ? "default" : "pointer",
            }}
          >
            {saving ? "Saving..." : `Save ${selectedCount} swatch${selectedCount === 1 ? "" : "es"} to palette`}
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
        opacity: selected ? 1 : 0.5,
        background: "white",
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

function QueryView() {
  const [hex, setHex] = useState("#c4a87b");
  const [results, setResults] = useState<PaletteQueryResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onQuery() {
    setError(undefined);
    try {
      const r = await paletteQuery(hex, 5);
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
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          style={{ width: 48, height: 36, border: "1px solid #ccc", borderRadius: 4 }}
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          style={{ width: 120, padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, fontFamily: "monospace" }}
        />
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
          No entries in the palette yet. Upload a burned test photo to populate it.
        </div>
      )}
      <div>
        {results.map((r) => (
          <ResultRow key={r.entry.id} result={r} />
        ))}
      </div>
    </div>
  );
}

function ResultRow({ result }: { result: PaletteQueryResult }) {
  const p = result.entry.params;
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
      <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace" }}>
        P={p.power}% S={p.speed} F={p.frequency} D={p.density} ×{p.passes} PW={p.pulse_width} {p.laser}
      </div>
    </div>
  );
}

function BrowseView() {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [error, setError] = useState<string | undefined>();

  async function refresh() {
    setError(undefined);
    try {
      setEntries(await paletteList());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { refresh(); }, []);

  async function onDelete(id: string) {
    try {
      await paletteDelete(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function onDeleteTest(testId: string) {
    if (!confirm(`Delete all palette entries from test "${testId}"?`)) return;
    try {
      await paletteDeleteByTest(testId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const byTest: Record<string, PaletteEntry[]> = {};
  entries.forEach((e) => {
    (byTest[e.test_id] = byTest[e.test_id] ?? []).push(e);
  });

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Palette ({entries.length} entries)</h2>
      {error && <div style={{ color: "#a02840", marginBottom: 12 }}>{error}</div>}
      {entries.length === 0 && !error && (
        <div style={{ color: "#888" }}>Empty — upload a burned test photo to populate.</div>
      )}
      {Object.entries(byTest).map(([testId, group]) => (
        <div key={testId} style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Test <code>{testId}</code></h3>
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
              <EntryCard key={e.id} entry={e} onDelete={() => onDelete(e.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EntryCard({ entry, onDelete }: { entry: PaletteEntry; onDelete: () => void }) {
  const tooltip = [entry.hex, ...Object.entries(entry.params).map(([k, v]) => `${k}=${v}`)].join("\n");
  return (
    <div title={tooltip}
         style={{ border: "1px solid #ddd", padding: 4, borderRadius: 4, background: "white" }}>
      <div style={{ background: entry.hex, height: 40, borderRadius: 2, border: "1px solid #ccc" }} />
      <div style={{ fontSize: 10, fontFamily: "monospace", marginTop: 2 }}>{entry.hex}</div>
      <button onClick={onDelete} style={{
        fontSize: 10, color: "#a02840", padding: 0, background: "none",
        border: "none", cursor: "pointer", marginTop: 2,
      }}>
        delete
      </button>
    </div>
  );
}
