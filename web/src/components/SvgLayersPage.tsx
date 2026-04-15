import { useEffect, useMemo, useRef, useState } from "react";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { defaultBaseParams } from "../defaults";
import { detectSvgLayers, previewSvg, rasterToSvg, svgLayersAndDownload } from "../generate";
import type { RasterTraceOptions } from "../generate";
import type { DetectedLayer, LayerSpec, SvgLayersRequest, SvgProcessingType } from "../types";

const PROCESSING_TYPES: { value: SvgProcessingType; label: string }[] = [
  { value: "COLOR_FILL_ENGRAVE", label: "Color fill engrave" },
  { value: "FILL_VECTOR_ENGRAVING", label: "Fill vector engrave" },
  { value: "VECTOR_ENGRAVING", label: "Vector engrave" },
  { value: "VECTOR_CUTTING", label: "Vector cut" },
];

function defaultLayerFromDetected(detected: DetectedLayer): LayerSpec {
  return {
    color: detected.color,
    name: detected.color,
    enabled: true,
    processing_type: detected.is_fill ? "COLOR_FILL_ENGRAVE" : "VECTOR_ENGRAVING",
    scan_angle: 90,
    base_params: defaultBaseParams(),
    crosshatch_enabled: false,
    crosshatch_passes: 2,
    crosshatch_step_deg: 90,
  };
}

function defaultRequest(): SvgLayersRequest {
  return {
    name: "svg-layers",
    svg_content: "",
    width_mm: 50,
    height_mm: null,
    start_x: 10,
    start_y: 10,
    layers: [],
    subtract_overlaps: false,
  };
}

export function SvgLayersPage() {
  const [request, setRequest] = useState<SvgLayersRequest>(() => defaultRequest());
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
  const [traceOptions, setTraceOptions] = useState<RasterTraceOptions>({
    color_precision: 4,
    layer_difference: 32,
    filter_speckle: 8,
  });
  const [tracing, setTracing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  async function applyDetectedSvg(svgText: string, suggestedName: string) {
    setRequest((prev) => ({ ...prev, svg_content: svgText, name: suggestedName, layers: [] }));
    try {
      const detected = await detectSvgLayers(svgText, 50);
      const layers = detected.map(defaultLayerFromDetected);
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
  const disabled = !hasLayers || !request.layers.some((l) => l.enabled) || generating;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 400px 1fr", height: "100%", minHeight: 0 }}>
      {/* LEFT: layer list */}
      <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto", padding: 12 }}>
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
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 4 }}>
              Trace options (PNG/JPG)
            </div>
            <div style={{ fontSize: 10, color: "#999", marginBottom: 6 }}>
              Re-vectorizes on change. Lower values = fewer layers.
            </div>
            <NumberField
              label="Color precision (1-8)"
              value={traceOptions.color_precision} integer min={1} max={8}
              onChange={(v) => updateTraceOptions({ color_precision: v })}
            />
            <NumberField
              label="Layer difference (0-255)"
              value={traceOptions.layer_difference} integer min={0} max={255}
              onChange={(v) => updateTraceOptions({ layer_difference: v })}
            />
            <NumberField
              label="Filter speckle (0-100)"
              value={traceOptions.filter_speckle} integer min={0} max={100}
              onChange={(v) => updateTraceOptions({ filter_speckle: v })}
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
            layer={selected}
            onPatch={(p) => updateLayer(selected.color, p)}
            onBasePatch={(p) => updateBase(selected.color, p)}
          />
        ) : (
          <div style={{ padding: 32, color: "#999" }}>Select a layer to edit its params.</div>
        )}
      </div>

      {/* RIGHT: preview — flex-column so the SVG pane fills the remaining height */}
      <div style={{ padding: 16, background: "#f6f7f9", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
          Preview {selectedColor && `— highlighted: ${selectedColor}`}
        </div>
        <SvgPreview
          svg={subtractedSvg ?? request.svg_content}
          highlightColor={selectedColor}
          enabledColors={enabledColors}
        />
      </div>
    </div>
  );
}

function LayerEditor({
  layer, onPatch, onBasePatch,
}: {
  layer: LayerSpec;
  onPatch: (p: Partial<LayerSpec>) => void;
  onBasePatch: (p: Partial<LayerSpec["base_params"]>) => void;
}) {
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

      <Section title="Processing">
        <SelectField
          label="Processing type"
          value={layer.processing_type}
          options={PROCESSING_TYPES}
          onChange={(v) => onPatch({ processing_type: v })}
        />
        <NumberField label="Scan angle (°)" value={layer.scan_angle} onChange={(v) => onPatch({ scan_angle: v })} />
      </Section>

      <Section title="Crosshatch (per-layer stacking)">
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={layer.crosshatch_enabled}
            onChange={(e) => onPatch({ crosshatch_enabled: e.target.checked })}
          />
          <span style={{ fontSize: 12, color: "#555" }}>Enable crosshatch</span>
        </label>
        {layer.crosshatch_enabled && (
          <>
            <NumberField label="Passes" value={layer.crosshatch_passes} integer min={2} max={10} onChange={(v) => onPatch({ crosshatch_passes: v })} />
            <NumberField label="Rotation step (°)" value={layer.crosshatch_step_deg} onChange={(v) => onPatch({ crosshatch_step_deg: v })} />
          </>
        )}
      </Section>

      <Section title="Base parameters">
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
  svg, highlightColor, enabledColors,
}: {
  svg: string;
  highlightColor: string | null;
  enabledColors: Set<string>;
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
      // Reset
      el.style.opacity = "";
      el.style.display = "";
      // Skip structural elements (svg, g, defs, etc.) that don't have their own color
      if (el.tagName === "svg" || el.tagName === "g" || el.tagName === "defs") return;

      const color = colorOf(el);
      if (!color) return;  // leave uncolored elements visible

      // Hide entirely if this element's layer is disabled
      if (!enabledColors.has(color)) {
        el.style.display = "none";
        return;
      }

      // Dim if not the highlighted layer
      if (highlightColor && color !== highlightColor) {
        el.style.opacity = "0.15";
      }
    });
  }, [svg, highlightColor, enabledColors]);

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
