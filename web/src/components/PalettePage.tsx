import { useState } from "react";
import { captureIngest, paletteIngest } from "../palette-api";
import type { CaptureIngestResponse, CaptureSwatch } from "../types";

const SIGMA_WARN = 10;

export function PalettePage() {
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
      // Default: auto-select all swatches below the noise threshold
      const initial: Record<number, boolean> = {};
      r.swatches.forEach((s, i) => {
        initial[i] = s.sigma < SIGMA_WARN;
      });
      setSelected(initial);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
      // Clear the file input so the same file can be re-uploaded if needed
      e.target.value = "";
    }
  }

  async function onSave() {
    if (!response) return;
    const swatchesToSave = response.swatches.filter((_, i) => selected[i]);
    if (swatchesToSave.length === 0) return;
    setSaving(true);
    try {
      const r = await paletteIngest({
        test_id: response.test_id,
        x_param: response.x_param,
        y_param: response.y_param,
        base_params: response.base_params,
        swatches: swatchesToSave,
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
    <div style={{ padding: 24, overflow: "auto", height: "100%" }}>
      <h2 style={{ marginTop: 0 }}>Upload burned test photo</h2>
      <p style={{ color: "#555", maxWidth: 600, marginTop: 0 }}>
        Take a roughly top-down photo of a burned registration sheet. The QR code carries
        the test's base parameters — each detected cell becomes a swatch you can save to
        the palette.
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
