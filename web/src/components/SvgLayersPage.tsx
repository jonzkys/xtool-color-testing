import { useEffect, useMemo, useRef, useState } from "react";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { defaultBaseParams, defaultHatchPass } from "../defaults";
import { DEFAULT_RASTER_TRACE_OPTIONS, detectSvgLayers, previewSvg, rasterToSvg, svgLayersAndDownload } from "../generate";
import type { RasterTraceOptions } from "../generate";
import type { DetectedLayer, LayerSpec, SvgLayersRequest, SvgProcessingType } from "../types";
import { HatchPassesEditor } from "./HatchPassesEditor";
import { validateLayerSpec } from "../validation";
import type { LibraryState } from "../library";
import { MaterialPresetPicker } from "./MaterialPresetPicker";
import { paletteQuery } from "../palette-api";
import type { BaseParams, LegacyPaletteQueryResult as PaletteQueryResult } from "../types";

const PROCESSING_TYPES: { value: SvgProcessingType; label: string }[] = [
  { value: "COLOR_FILL_ENGRAVE", label: "Color fill engrave" },
  { value: "FILL_VECTOR_ENGRAVING", label: "Fill vector engrave" },
  { value: "VECTOR_ENGRAVING", label: "Vector engrave" },
  { value: "VECTOR_CUTTING", label: "Vector cut" },
  { value: "HATCHED_LINES", label: "Hatched lines" },
];

function seedLayerBaseParams(library: LibraryState) {
  const defaultPreset = library.presets.find(
    (p) => p.material_id === library.active_material_id && p.is_default,
  );
  return defaultPreset
    ? { materialId: library.active_material_id !== null ? String(library.active_material_id) : null, baseParams: { ...defaultPreset.base_params } }
    : { materialId: null as string | null, baseParams: defaultBaseParams() };
}

function defaultLayerFromDetected(detected: DetectedLayer, library: LibraryState): LayerSpec {
  const seed = seedLayerBaseParams(library);
  return {
    color: detected.color,
    name: detected.color,
    enabled: true,
    processing_type: detected.is_fill ? "COLOR_FILL_ENGRAVE" : "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: seed.baseParams,
    angle_mode: "fixed",
    material_id: seed.materialId,
    hatch_passes: [],
  };
}

function defaultRequest(materialId: string): SvgLayersRequest {
  return {
    name: "svg-layers",
    svg_content: "",
    width_mm: 50,
    height_mm: null,
    start_x: 10,
    start_y: 10,
    material_id: materialId,
    layers: [],
    // On by default — adjacent layers shouldn't re-engrave the same pixel and
    // the subtracted preview is almost always what users want to see first.
    subtract_overlaps: true,
  };
}

interface Props {
  library: LibraryState;
}

export function SvgLayersPage({ library }: Props) {
  const [request, setRequest] = useState<SvgLayersRequest>(
    () => defaultRequest(library.active_material_id !== null ? String(library.active_material_id) : ""),
  );
  const [filename, setFilename] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [detectError, setDetectError] = useState<string | undefined>();
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  // When subtract_overlaps is on we display the server-computed subtracted SVG
  // instead of the raw upload, so the preview matches what will be engraved.
  const [subtractedSvg, setSubtractedSvg] = useState<string | null>(null);
  // Raster -> SVG support. When the user uploads a PNG/JPG we keep its data URL
  // so we can re-trace with different options without re-uploading.
  const [rasterDataUrl, setRasterDataUrl] = useState<string | null>(null);
  const [traceOptions, setTraceOptions] = useState<RasterTraceOptions>(
    () => ({ ...DEFAULT_RASTER_TRACE_OPTIONS }),
  );
  const [tracing, setTracing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // layer.color → predicted burn hex from the last palette match applied to it.
  // Used to render the "expected burn" preview and doesn't get persisted.
  const [predictedByColor, setPredictedByColor] = useState<Record<string, string>>({});
  const [autoApplying, setAutoApplying] = useState(false);
  const [autoApplyMessage, setAutoApplyMessage] = useState<string | undefined>();

  const selected = useMemo(
    () => request.layers.find((l) => l.color === selectedColor) ?? null,
    [request.layers, selectedColor],
  );

  const enabledColors = useMemo(
    () => new Set(request.layers.filter((l) => l.enabled).map((l) => l.color)),
    [request.layers],
  );

  // Fetch a server-subtracted SVG whenever subtract_overlaps is on and the
  // inputs that affect it change. When off, clear so the original is used.
  useEffect(() => {
    if (!request.subtract_overlaps || !request.svg_content) {
      setSubtractedSvg(null);
      return;
    }
    let cancelled = false;
    previewSvg(request.svg_content, {
      enabled_colors: [...enabledColors],
      subtract_overlaps: true,
      width_mm: request.width_mm,
    })
      .then((svg) => { if (!cancelled) setSubtractedSvg(svg); })
      .catch(() => { if (!cancelled) setSubtractedSvg(null); });
    return () => { cancelled = true; };
  }, [request.subtract_overlaps, request.svg_content, request.width_mm, enabledColors]);

  function updateReq(patch: Partial<SvgLayersRequest>) {
    setRequest((prev) => ({ ...prev, ...patch }));
  }

  function updateLayer(color: string, patch: Partial<LayerSpec>) {
    setRequest((prev) => ({
      ...prev,
      layers: prev.layers.map((l) => (l.color === color ? { ...l, ...patch } : l)),
    }));
  }

  function updateBase(color: string, patch: Partial<LayerSpec["base_params"]>) {
    setRequest((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.color === color ? { ...l, base_params: { ...l.base_params, ...patch } } : l,
      ),
    }));
  }

  function applyPaletteMatch(
    color: string,
    params: Partial<LayerSpec["base_params"]>,
    predictedHex: string,
  ) {
    updateBase(color, params);
    setPredictedByColor((prev) => ({ ...prev, [color]: predictedHex }));
  }

  async function autoMatchAllLayers() {
    if (!request.material_id || request.layers.length === 0) return;
    setAutoApplying(true);
    setAutoApplyMessage(undefined);
    try {
      // Query each hex-coloured layer in parallel. Layers with "none" or
      // materials lacking matches fall through to "skipped".
      const results = await Promise.all(request.layers.map(async (l) => {
        if (!/^#[0-9a-fA-F]{6}$/.test(l.color)) return { layer: l, best: null };
        const res = await paletteQuery(l.color, 1, request.material_id);
        return { layer: l, best: res[0] ?? null };
      }));

      let applied = 0;
      const nextPredicted: Record<string, string> = { ...predictedByColor };
      setRequest((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => {
          const match = results.find((r) => r.layer.color === l.color);
          if (!match?.best) return l;
          const newParams = paletteParamsToBaseParams(match.best.entry.params);
          nextPredicted[l.color] = match.best.entry.hex;
          applied += 1;
          return { ...l, base_params: { ...l.base_params, ...newParams } };
        }),
      }));
      setPredictedByColor(nextPredicted);

      const skipped = results.length - applied;
      setAutoApplyMessage(
        skipped === 0
          ? `Applied matches to all ${applied} layer${applied === 1 ? "" : "s"}.`
          : `Applied to ${applied}/${results.length} layers (${skipped} skipped — no palette match).`,
      );
    } catch (err) {
      setAutoApplyMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setAutoApplying(false);
    }
  }

  async function applyDetectedSvg(svgText: string, suggestedName: string) {
    setRequest((prev) => ({ ...prev, svg_content: svgText, name: suggestedName, layers: [] }));
    try {
      const detected = await detectSvgLayers(svgText, 50);
      const layers = detected.map((d) => defaultLayerFromDetected(d, library));
      setRequest((prev) => ({ ...prev, layers }));
      setSelectedColor(layers[0]?.color ?? null);
    } catch (err) {
      setDetectError((err as Error).message);
    }
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file: File) {
    if (!file) return;
    setDetectError(undefined);
    setFilename(file.name);
    const suggested =
      file.name.replace(/\.(svg|png|jpe?g)$/i, "").replace(/[^A-Za-z0-9._\- ]/g, "_").slice(0, 64) ||
      "svg-layers";

    const isRaster = /\.(png|jpe?g)$/i.test(file.name) || file.type.startsWith("image/");
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";

    if (isSvg || !isRaster) {
      // SVG path
      setRasterDataUrl(null);
      const text = await file.text();
      await applyDetectedSvg(text, suggested);
      return;
    }

    // Raster path: vectorize via backend, then feed the SVG through detection.
    const dataUrl = await fileToDataUrl(file);
    setRasterDataUrl(dataUrl);
    setTracing(true);
    try {
      const svg = await rasterToSvg(dataUrl, traceOptions);
      await applyDetectedSvg(svg, suggested);
    } catch (err) {
      setDetectError((err as Error).message);
    } finally {
      setTracing(false);
    }
  }

  async function retrace(opts: RasterTraceOptions) {
    if (!rasterDataUrl) return;
    setDetectError(undefined);
    setTracing(true);
    try {
      const svg = await rasterToSvg(rasterDataUrl, opts);
      const currentName = request.name;
      await applyDetectedSvg(svg, currentName);
    } catch (err) {
      setDetectError((err as Error).message);
    } finally {
      setTracing(false);
    }
  }

  function updateTraceOptions(patch: Partial<RasterTraceOptions>) {
    const next = { ...traceOptions, ...patch };
    setTraceOptions(next);
    if (rasterDataUrl) void retrace(next);
  }

  function resetTraceOptions() {
    const defaults = { ...DEFAULT_RASTER_TRACE_OPTIONS };
    setTraceOptions(defaults);
    if (rasterDataUrl) void retrace(defaults);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }

  async function handleGenerate() {
    setErrorMessage(undefined);
    setGenerating(true);
    try {
      await svgLayersAndDownload(request);
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const hasLayers = request.layers.length > 0;
  const hatchedHasErrors = request.layers.some(
    (l, i) => l.enabled && validateLayerSpec(l, i).some((iss) => iss.severity === "error")
  );
  const disabled = !hasLayers
    || !request.layers.some((l) => l.enabled)
    || !request.material_id
    || generating
    || hatchedHasErrors;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr minmax(0, 33vw)", height: "100%", minHeight: 0 }}>
      {/* LEFT: layer list */}
      <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto", padding: 12 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 4 }}>
          Material
        </div>
        <select
          value={request.material_id}
          onChange={(e) => setRequest((prev) => ({ ...prev, material_id: e.target.value }))}
          style={{
            width: "100%", padding: "6px 8px", marginBottom: 12,
            border: `1px solid ${request.material_id ? "#ccc" : "#a02840"}`,
            borderRadius: 4, font: "inherit", background: "white",
          }}
        >
          {!request.material_id && <option value="">— pick a material —</option>}
          {library.materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
          SVG
        </div>
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            border: "1px dashed #999", borderRadius: 4,
            padding: 12, textAlign: "center", cursor: "pointer",
            background: filename ? "#e8ecf3" : "transparent",
            color: filename ? "#336" : "#666", fontSize: 12, marginBottom: 12,
          }}
        >
          {filename ? `${filename}` : "Drop SVG / PNG / JPG or click"}
          {tracing && <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>Tracing...</div>}
        </div>
        <input
          ref={fileInputRef} type="file" accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
          onChange={onFileChange} style={{ display: "none" }}
        />
        {detectError && <div style={{ color: "#a02840", fontSize: 12, marginBottom: 8 }}>{detectError}</div>}

        {rasterDataUrl && (
          <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #eee" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666" }}>
                Trace options (PNG/JPG)
              </div>
              <button
                onClick={resetTraceOptions}
                style={{
                  fontSize: 10, padding: "2px 6px", background: "transparent",
                  border: "1px solid #bbb", borderRadius: 3, color: "#555",
                }}
              >
                Reset
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#999", marginBottom: 6 }}>
              Re-vectorizes on change. Lower values = fewer layers.
            </div>
            <NumberField
              label="Max colors (0 = off)"
              value={traceOptions.max_colors} integer min={0} max={256}
              onChange={(v) => updateTraceOptions({ max_colors: v })}
              help="Pre-quantizes the image to this many colors using PIL median-cut BEFORE vtracer sees it. The most effective control for photos. Set to 0 to disable. Typical: 3-8 for clean output, 16+ for more detail."
            />
            <NumberField
              label="Color precision (1-8)"
              value={traceOptions.color_precision} integer min={1} max={8}
              onChange={(v) => updateTraceOptions({ color_precision: v })}
              help="Bit depth vtracer uses internally for color quantization. Lower = chunkier color groups; higher = preserves subtle differences. Default 4 is a balance."
            />
            <NumberField
              label="Layer difference (0-255)"
              value={traceOptions.layer_difference} integer min={0} max={255}
              onChange={(v) => updateTraceOptions({ layer_difference: v })}
              help="Minimum visual distance between two output layers. Higher values merge near-identical colors into one layer. Bump this if you see lots of barely-different shades. Default 32; 64-96 for aggressive merging."
            />
            <NumberField
              label="Filter speckle (0-100)"
              value={traceOptions.filter_speckle} integer min={0} max={100}
              onChange={(v) => updateTraceOptions({ filter_speckle: v })}
              help="Drops isolated regions smaller than this many pixels - kills noise from JPEG artifacts and photo grain. Higher = cleaner output but loses fine detail. Default 8."
            />
          </div>
        )}

        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 4 }}>
          Layers {hasLayers && `(${request.layers.length})`}
        </div>
        {hasLayers && (
          <div style={{ fontSize: 10, color: "#999", marginBottom: 6 }}>
            Top of list = drawn on top. Subtraction removes lower layers where upper ones cover them.
          </div>
        )}
        {hasLayers && (
          <div style={{ marginBottom: 8 }}>
            <button
              onClick={autoMatchAllLayers}
              disabled={!request.material_id || autoApplying}
              title={!request.material_id
                ? "Pick a material above first"
                : "Query the palette for each layer's colour and apply the closest match"}
              style={{
                width: "100%", padding: "6px 8px", fontSize: 12,
                background: !request.material_id || autoApplying ? "#ccc" : "#e8ecf3",
                color: !request.material_id || autoApplying ? "#888" : "#336",
                border: `1px solid ${!request.material_id || autoApplying ? "#bbb" : "#336"}`,
                borderRadius: 4,
                cursor: !request.material_id || autoApplying ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              {autoApplying ? "Matching…" : "Auto-match all layers to palette"}
            </button>
            {autoApplyMessage && (
              <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>{autoApplyMessage}</div>
            )}
          </div>
        )}
        {!hasLayers && (
          <div style={{ fontSize: 12, color: "#999" }}>Upload an SVG to detect layers.</div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {/* Reverse so topmost (last drawn in SVG) appears at the top of the list,
              matching Photoshop/Illustrator conventions and making the "subtract
              overlaps" behaviour visually intuitive. Order doesn't affect the
              backend request - the converter maps by color. */}
          {[...request.layers].reverse().map((l) => {
            const isSel = selectedColor === l.color;
            return (
              <li key={l.color}>
                <button
                  onClick={() => setSelectedColor(l.color)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 8px", textAlign: "left",
                    border: "1px solid " + (isSel ? "#336" : "#ddd"),
                    background: isSel ? "#e8ecf3" : "white",
                    borderRadius: 4,
                    opacity: l.enabled ? 1 : 0.5,
                  }}
                >
                  <span
                    style={{
                      width: 16, height: 16, borderRadius: 3,
                      background: l.color, border: "1px solid #999",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {l.name}
                  </span>
                  <input
                    type="checkbox"
                    checked={l.enabled}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateLayer(l.color, { enabled: e.target.checked })}
                    title={l.enabled ? "Disable layer" : "Enable layer"}
                  />
                </button>
              </li>
            );
          })}
        </ul>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
            Project
          </div>
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Output filename</span>
            <input
              value={request.name}
              onChange={(e) => updateReq({ name: e.target.value })}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, font: "inherit" }}
            />
          </label>
          <NumberField label="Width (mm)" value={request.width_mm} onChange={(v) => updateReq({ width_mm: v })} />
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Height (mm, blank = aspect)</span>
            <input
              type="number"
              value={request.height_mm ?? ""}
              step="any"
              onChange={(e) => updateReq({ height_mm: e.target.value === "" ? null : parseFloat(e.target.value) })}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, font: "inherit" }}
            />
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, marginTop: 8 }}>
            <input
              type="checkbox"
              checked={request.subtract_overlaps}
              onChange={(e) => updateReq({ subtract_overlaps: e.target.checked })}
              style={{ marginTop: 2 }}
            />
            <span style={{ color: "#555" }}>
              Subtract overlaps
              <div style={{ color: "#888", fontSize: 11 }}>No double-engrave regions.</div>
            </span>
          </label>
        </div>

        <button
          onClick={handleGenerate}
          disabled={disabled}
          style={{
            width: "100%", padding: "10px 16px", marginTop: 12,
            background: disabled ? "#ccc" : "#336",
            color: "white", border: "none", borderRadius: 4, fontWeight: 600,
          }}
        >
          {generating ? "Generating..." : "Generate .xcs"}
        </button>
        {errorMessage && <div style={{ marginTop: 8, color: "#a02840", fontSize: 12 }}>{errorMessage}</div>}
      </div>

      {/* MIDDLE: selected layer editor */}
      <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto", padding: 16 }}>
        {selected ? (
          <LayerEditor
            key={selected.color}
            layer={selected}
            layerIdx={request.layers.findIndex((l) => l.color === selected.color)}
            library={library}
            projectMaterialId={request.material_id}
            onPatch={(p) => updateLayer(selected.color, p)}
            onBasePatch={(p) => updateBase(selected.color, p)}
            onPaletteApply={(params, hex) => applyPaletteMatch(selected.color, params, hex)}
          />
        ) : (
          <div style={{ padding: 32, color: "#999" }}>Select a layer to edit its params.</div>
        )}
      </div>

      {/* RIGHT: two stacked previews — design colours vs expected burn */}
      <div style={{ padding: 16, background: "#f6f7f9", display: "flex", flexDirection: "column", minHeight: 0, gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 6 }}>
            Design {selectedColor && `— highlighted: ${selectedColor}`}
          </div>
          <SvgPreview
            svg={subtractedSvg ?? request.svg_content}
            highlightColor={selectedColor}
            enabledColors={enabledColors}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 6 }}>
            Expected burn
            {Object.keys(predictedByColor).length === 0 && (
              <span style={{ textTransform: "none", color: "#a05000", marginLeft: 6 }}>
                — apply palette matches to populate
              </span>
            )}
          </div>
          <SvgPreview
            svg={subtractedSvg ?? request.svg_content}
            highlightColor={null}
            enabledColors={enabledColors}
            colorMap={predictedByColor}
          />
        </div>
      </div>
    </div>
  );
}

function LayerEditor({
  layer, layerIdx, library, projectMaterialId,
  onPatch, onBasePatch, onPaletteApply,
}: {
  layer: LayerSpec;
  layerIdx: number;
  library: LibraryState;
  projectMaterialId: string;
  onPatch: (p: Partial<LayerSpec>) => void;
  onBasePatch: (p: Partial<LayerSpec["base_params"]>) => void;
  onPaletteApply: (params: Partial<LayerSpec["base_params"]>, predictedHex: string) => void;
}) {
  const hatchIssues = validateLayerSpec(layer, layerIdx);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span
          style={{
            width: 28, height: 28, borderRadius: 4,
            background: layer.color, border: "1px solid #999",
            flexShrink: 0,
          }}
        />
        <input
          value={layer.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          style={{ flex: 1, fontSize: 18, padding: "6px 8px", border: "1px solid transparent", borderRadius: 4 }}
        />
      </div>

      {layer.color !== "none" && (
        <PaletteMatchSection
          layerColor={layer.color}
          materialId={projectMaterialId}
          onApply={onPaletteApply}
        />
      )}

      <Section title="Processing">
        <SelectField
          label="Processing type"
          value={layer.processing_type}
          options={PROCESSING_TYPES}
          onChange={(v) => {
            const patch: Partial<LayerSpec> = { processing_type: v };
            if (v === "HATCHED_LINES" && layer.hatch_passes.length === 0) {
              patch.hatch_passes = [defaultHatchPass(0)];
            }
            onPatch(patch);
          }}
        />
        {layer.processing_type !== "HATCHED_LINES" && (
          <NumberField label="Scan angle (°)" value={layer.scan_angle} onChange={(v) => onPatch({ scan_angle: v })} />
        )}
      </Section>

      {layer.processing_type !== "HATCHED_LINES" && (
        <Section title="Passes (multi-pass angle)">
          <SelectField
            label="Angle mode"
            value={layer.angle_mode}
            options={[
              { value: "fixed", label: "Fixed — all passes at scan angle" },
              { value: "crosshatch", label: "Crosshatch — alternate ±90°" },
              { value: "incremental", label: "Incremental — XCS rotates per pass" },
            ]}
            onChange={(v) => onPatch({ angle_mode: v as LayerSpec["angle_mode"] })}
          />
          <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>
            Pass count comes from <strong>Base parameters → Passes</strong>.
            XCS handles the stacking natively; no rect duplication.
          </div>
        </Section>
      )}

      {layer.processing_type === "HATCHED_LINES" && (
        <HatchPassesEditor
          passes={layer.hatch_passes}
          onChange={(next) => onPatch({ hatch_passes: next })}
          issues={hatchIssues}
          layerIdx={layerIdx}
        />
      )}

      <Section title="Base parameters">
        <MaterialPresetPicker
          library={library}
          materialId={layer.material_id}
          baseParams={layer.base_params}
          onApply={(materialId, baseParams) => {
            onPatch({ material_id: materialId, base_params: { ...baseParams } });
          }}
        />
        <NumberField label="Power %" value={layer.base_params.power} onChange={(v) => onBasePatch({ power: v })} />
        <NumberField label="Speed (mm/s)" value={layer.base_params.speed} integer onChange={(v) => onBasePatch({ speed: v })} />
        <NumberField label="Frequency (Hz)" value={layer.base_params.frequency} integer onChange={(v) => onBasePatch({ frequency: v })} />
        <NumberField label="Lines/cm" value={layer.base_params.density} integer onChange={(v) => onBasePatch({ density: v })} />
        <NumberField label="Passes" value={layer.base_params.passes} integer min={1} onChange={(v) => onBasePatch({ passes: v })} />
        <NumberField label="Pulse width (ns)" value={layer.base_params.pulse_width} integer onChange={(v) => onBasePatch({ pulse_width: v })} />
        <SelectField
          label="Laser"
          value={layer.base_params.laser}
          options={[{ value: "red" as const, label: "Red (MOPA)" }, { value: "blue" as const, label: "Blue (diode)" }]}
          onChange={(v) => onBasePatch({ laser: v })}
        />
      </Section>
    </>
  );
}

function SvgPreview({
  svg, highlightColor, enabledColors, colorMap,
}: {
  svg: string;
  highlightColor: string | null;
  enabledColors: Set<string>;
  /**
   * Optional: repaint the SVG with each layer colour remapped to its predicted
   * burn hex. Used for the "expected burn" side-by-side view.
   */
  colorMap?: Record<string, string>;
}) {
  // Walks the rendered SVG DOM and for each leaf element:
  // - hides it entirely if its color isn't in enabledColors (layer disabled)
  // - dims to 15% if its color doesn't match highlightColor (other enabled layers)
  // - shows at full opacity if it matches highlightColor (currently editing)
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const svgEl = wrapper.querySelector("svg");
    if (!svgEl) return;

    // Make the uploaded SVG fill its container responsively. Uploaded SVGs
    // often have fixed width/height attrs that stop them scaling to the
    // available space.
    const originalW = svgEl.getAttribute("width");
    const originalH = svgEl.getAttribute("height");
    if (!svgEl.getAttribute("viewBox") && originalW && originalH) {
      // Some SVGs have width/height but no viewBox; synthesize one so scaling works.
      const w = parseFloat(originalW);
      const h = parseFloat(originalH);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
      }
    }
    svgEl.setAttribute("width", "100%");
    svgEl.setAttribute("height", "100%");
    svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svgEl.style.width = "100%";
    svgEl.style.height = "100%";
    svgEl.style.display = "block";

    const elements = svgEl.querySelectorAll<SVGElement>("*");

    const colorOf = (el: SVGElement): string | null => {
      const fill = el.getAttribute("fill");
      const stroke = el.getAttribute("stroke");
      const style = el.getAttribute("style") || "";
      const styleFill = style.match(/fill:\s*([^;]+)/)?.[1];
      const styleStroke = style.match(/stroke:\s*([^;]+)/)?.[1];
      const candidates = [fill, stroke, styleFill ?? null, styleStroke ?? null];
      for (const c of candidates) {
        if (c && c !== "none") return normalizeColor(c);
      }
      return null;
    };

    elements.forEach((el) => {
      // Reset per-pass state
      el.style.opacity = "";
      el.style.display = "";
      // Skip structural elements (svg, g, defs, etc.) that don't have their own color
      if (el.tagName === "svg" || el.tagName === "g" || el.tagName === "defs") return;

      // First time we see this element, stash the ORIGINAL layer colour. The
      // colorMap path mutates fill/stroke attributes, so on subsequent passes
      // colorOf() would read the REMAPPED hex and think the element is from a
      // different (disabled) layer — hiding it. We always consult the stashed
      // original instead.
      let color = el.getAttribute("data-xcs-orig-color");
      if (color === null) {
        const detected = colorOf(el);
        if (!detected) {
          el.setAttribute("data-xcs-orig-color", "");
          return;
        }
        color = detected;
        el.setAttribute("data-xcs-orig-color", detected);
      }
      if (color === "") return;  // uncoloured — leave alone

      // Hide entirely if this element's layer is disabled
      if (!enabledColors.has(color)) {
        el.style.display = "none";
        return;
      }

      // Dim if not the highlighted layer
      if (highlightColor && color !== highlightColor) {
        el.style.opacity = "0.15";
      }

      // Paint the expected burn colour if we have a prediction; otherwise
      // restore the original colour in case a previous colorMap mutated it.
      const desired = (colorMap && colorMap[color]) ? colorMap[color] : color;
      if (el.getAttribute("fill") && el.getAttribute("fill") !== "none") {
        el.setAttribute("fill", desired);
      }
      if (el.getAttribute("stroke") && el.getAttribute("stroke") !== "none") {
        el.setAttribute("stroke", desired);
      }
      const styleAttr = el.getAttribute("style");
      if (styleAttr && /(fill|stroke):/.test(styleAttr)) {
        const replaced = styleAttr
          .replace(/fill:\s*[^;]+/, (m) => m.includes("none") ? m : `fill: ${desired}`)
          .replace(/stroke:\s*[^;]+/, (m) => m.includes("none") ? m : `stroke: ${desired}`);
        el.setAttribute("style", replaced);
      }
    });
  }, [svg, highlightColor, enabledColors, colorMap]);

  if (!svg) {
    return (
      <div style={{ background: "white", border: "1px solid #ddd", borderRadius: 4, padding: 32, textAlign: "center", color: "#999" }}>
        Upload an SVG to preview
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        background: "white", border: "1px solid #ddd", borderRadius: 4,
        padding: 8, flex: 1, minHeight: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

// ΔE interpretation:
//   <  2   imperceptible to the eye
//   2-10  visible but close
//  10-30  different but related
//   >30   clearly distinct
// We render as a percentage match clamped to [0, 100] with 100 = ΔE 0.
function deltaEToPercent(dE: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - dE * 2)));
}

function paletteParamsToBaseParams(
  params: { [k: string]: string | number },
): Partial<BaseParams> {
  const laser = params["laser"];
  return {
    power: typeof params["power"] === "number" ? params["power"] : Number(params["power"]),
    speed: typeof params["speed"] === "number" ? Math.round(params["speed"]) : Math.round(Number(params["speed"])),
    frequency: typeof params["frequency"] === "number" ? Math.round(params["frequency"]) : Math.round(Number(params["frequency"])),
    density: typeof params["density"] === "number" ? Math.round(params["density"]) : Math.round(Number(params["density"])),
    passes: typeof params["passes"] === "number" ? Math.round(params["passes"]) : Math.round(Number(params["passes"])),
    pulse_width: typeof params["pulse_width"] === "number" ? Math.round(params["pulse_width"]) : Math.round(Number(params["pulse_width"])),
    laser: (laser === "blue" ? "blue" : "red"),
  };
}

function PaletteMatchSection({
  layerColor, materialId, onApply,
}: {
  layerColor: string;
  materialId: string;
  onApply: (params: Partial<BaseParams>, predictedHex: string) => void;
}) {
  const [results, setResults] = useState<PaletteQueryResult[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setResults([]);
    setSelectedId("");
    setError(undefined);
    if (!materialId || !/^#[0-9a-fA-F]{6}$/.test(layerColor)) return;
    setLoading(true);
    paletteQuery(layerColor, 10, materialId)
      .then((r) => { if (!cancelled) { setResults(r); setSelectedId(r[0]?.entry.id ?? ""); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [layerColor, materialId]);

  const selected = results.find((r) => r.entry.id === selectedId) ?? results[0];

  if (!materialId) {
    return (
      <div style={{ marginBottom: 16, padding: 10, background: "#fff8e1", border: "1px solid #f2c97e", borderRadius: 4, fontSize: 12, color: "#785400" }}>
        Pick a project material above to see palette matches for this layer.
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16, padding: 10, background: "#fafafa", border: "1px solid #ddd", borderRadius: 4 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
        Palette match
      </div>

      {loading && <div style={{ fontSize: 12, color: "#888" }}>Searching palette…</div>}
      {error && <div style={{ fontSize: 12, color: "#a02840" }}>{error}</div>}
      {!loading && !error && results.length === 0 && (
        <div style={{ fontSize: 12, color: "#888" }}>
          No palette entries for this material yet. Burn a test and upload it on the Palette tab.
        </div>
      )}

      {selected && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <SwatchBox color={layerColor} label="layer" />
            <div style={{ color: "#666", fontSize: 18 }}>→</div>
            <SwatchBox color={selected.entry.hex} label="palette" />
            <div style={{ marginLeft: 8, fontSize: 13 }}>
              <div><strong>{deltaEToPercent(selected.delta_e)}%</strong> match</div>
              <div style={{ color: "#888", fontSize: 11 }}>ΔE = {selected.delta_e.toFixed(2)}</div>
            </div>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => onApply(paletteParamsToBaseParams(selected.entry.params), selected.entry.hex)}
              style={{
                padding: "6px 12px", background: "#336", color: "white",
                border: "none", borderRadius: 4, fontWeight: 600, cursor: "pointer",
              }}
            >
              Apply
            </button>
          </div>

          {results.length > 1 && (
            <label style={{ display: "block", fontSize: 12, color: "#555" }}>
              <span style={{ marginRight: 6 }}>Choose match:</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                style={{ padding: "4px 6px", border: "1px solid #ccc", borderRadius: 4, font: "inherit", background: "white" }}
              >
                {results.map((r) => {
                  const p = r.entry.params;
                  return (
                    <option key={r.entry.id} value={r.entry.id}>
                      {r.entry.hex}  ΔE={r.delta_e.toFixed(1)}  ·  P={p.power}% S={p.speed} {p.laser}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          {selected && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#888", fontFamily: "monospace" }}>
              {Object.entries(paletteParamsToBaseParams(selected.entry.params))
                .map(([k, v]) => `${k}=${v}`).join("  ")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SwatchBox({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{
        width: 42, height: 42, borderRadius: 4, border: "1px solid #ccc",
        background: color,
      }} />
      <div style={{ fontSize: 9, color: "#888", marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 9, fontFamily: "monospace" }}>{color}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// Normalize a CSS color value (name, #abc, #aabbcc, rgb(...)) into lowercase #rrggbb.
// Used for matching the preview's shape colors against the backend's detected colors.
const NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00",
};

function normalizeColor(color: string): string {
  const c = color.trim().toLowerCase();
  if (c.startsWith("#")) {
    if (c.length === 4) {
      // #abc -> #aabbcc
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    }
    return c;
  }
  if (c.startsWith("rgb")) {
    const m = c.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const hex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
      return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
    }
  }
  return NAMED_COLORS[c] ?? c;
}
