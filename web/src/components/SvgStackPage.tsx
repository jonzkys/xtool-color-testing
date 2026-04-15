import { useRef, useState } from "react";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { defaultBaseParams } from "../defaults";
import { svgStackAndDownload } from "../generate";
import type { SvgProcessingType, SvgStackRequest } from "../types";

const PROCESSING_TYPES: { value: SvgProcessingType; label: string }[] = [
  { value: "COLOR_FILL_ENGRAVE", label: "Color fill engrave" },
  { value: "FILL_VECTOR_ENGRAVING", label: "Fill vector engrave" },
  { value: "VECTOR_ENGRAVING", label: "Vector engrave" },
  { value: "VECTOR_CUTTING", label: "Vector cut" },
];

function defaultRequest(): SvgStackRequest {
  return {
    name: "svg-stack",
    svg_content: "",
    width_mm: 50,
    height_mm: null,
    start_x: 10,
    start_y: 10,
    base_params: defaultBaseParams(),
    processing_type: "COLOR_FILL_ENGRAVE",
    scan_angle: 90,
    stack_passes: 2,
    stack_step_deg: 90,
  };
}

export function SvgStackPage() {
  const [request, setRequest] = useState<SvgStackRequest>(() => defaultRequest());
  const [filename, setFilename] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateReq(patch: Partial<SvgStackRequest>) {
    setRequest((prev) => ({ ...prev, ...patch }));
  }

  function updateBase(patch: Partial<SvgStackRequest["base_params"]>) {
    setRequest((prev) => ({ ...prev, base_params: { ...prev.base_params, ...patch } }));
  }

  async function handleFile(file: File) {
    if (!file) return;
    const text = await file.text();
    setFilename(file.name);
    // Suggest a name based on the filename (strip extension, sanitize)
    const suggested = file.name
      .replace(/\.svg$/i, "")
      .replace(/[^A-Za-z0-9._\- ]/g, "_")
      .slice(0, 64) || "svg-stack";
    updateReq({ svg_content: text, name: suggested });
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
      await svgStackAndDownload(request);
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const disabled = !request.svg_content || generating;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", height: "100%", minHeight: 0 }}>
      {/* LEFT: form */}
      <div style={{ borderRight: "1px solid #ddd", background: "white", overflow: "auto", padding: 16 }}>
        <Section title="SVG">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            style={{
              border: "1px dashed #999", borderRadius: 4,
              padding: 16, textAlign: "center", cursor: "pointer",
              background: filename ? "#e8ecf3" : "transparent",
              color: filename ? "#336" : "#666", fontSize: 13,
            }}
          >
            {filename ? `Loaded: ${filename}` : "Drop SVG here or click to browse"}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".svg,image/svg+xml"
            onChange={onFileChange}
            style={{ display: "none" }}
          />
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>Output filename</span>
              <input
                value={request.name}
                onChange={(e) => updateReq({ name: e.target.value })}
                style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, font: "inherit" }}
              />
            </label>
          </div>
        </Section>

        <Section title="Layout">
          <NumberField label="Width (mm)" value={request.width_mm} onChange={(v) => updateReq({ width_mm: v })} />
          <label style={{ display: "block", marginBottom: 8 }}>
            <span style={{ display: "block", fontSize: 12, color: "#555", marginBottom: 2 }}>
              Height (mm) — leave blank for aspect ratio
            </span>
            <input
              type="number"
              value={request.height_mm ?? ""}
              step="any"
              onChange={(e) => {
                const raw = e.target.value;
                updateReq({ height_mm: raw === "" ? null : parseFloat(raw) });
              }}
              style={{ width: "100%", padding: "6px 8px", border: "1px solid #ccc", borderRadius: 4, font: "inherit" }}
            />
          </label>
          <NumberField label="Start X (mm)" value={request.start_x} onChange={(v) => updateReq({ start_x: v })} />
          <NumberField label="Start Y (mm)" value={request.start_y} onChange={(v) => updateReq({ start_y: v })} />
        </Section>

        <Section title="Processing">
          <SelectField
            label="Processing type"
            value={request.processing_type}
            options={PROCESSING_TYPES}
            onChange={(v) => updateReq({ processing_type: v })}
          />
          <NumberField
            label="Scan angle (°) — base pass"
            value={request.scan_angle}
            onChange={(v) => updateReq({ scan_angle: v })}
          />
        </Section>

        <Section title="Stacking / crosshatch">
          <NumberField
            label="Passes"
            value={request.stack_passes}
            integer
            min={1}
            max={10}
            onChange={(v) => updateReq({ stack_passes: v })}
          />
          <NumberField
            label="Rotation step (°)"
            value={request.stack_step_deg}
            onChange={(v) => updateReq({ stack_step_deg: v })}
          />
        </Section>

        <Section title="Base parameters (fixed)">
          <NumberField label="Power %" value={request.base_params.power} onChange={(v) => updateBase({ power: v })} />
          <NumberField label="Speed (mm/s)" value={request.base_params.speed} integer onChange={(v) => updateBase({ speed: v })} />
          <NumberField label="Frequency (Hz)" value={request.base_params.frequency} integer onChange={(v) => updateBase({ frequency: v })} />
          <NumberField label="Lines/cm" value={request.base_params.density} integer onChange={(v) => updateBase({ density: v })} />
          <NumberField label="Passes (non-crosshatch)" value={request.base_params.passes} integer min={1} onChange={(v) => updateBase({ passes: v })} />
          <NumberField label="Pulse width (ns)" value={request.base_params.pulse_width} integer onChange={(v) => updateBase({ pulse_width: v })} />
          <SelectField
            label="Laser"
            value={request.base_params.laser}
            options={[{ value: "red" as const, label: "Red (MOPA)" }, { value: "blue" as const, label: "Blue (diode)" }]}
            onChange={(v) => updateBase({ laser: v })}
          />
        </Section>

        <button
          onClick={handleGenerate}
          disabled={disabled}
          style={{
            width: "100%", padding: "10px 16px", marginTop: 4,
            background: disabled ? "#ccc" : "#336",
            color: "white", border: "none", borderRadius: 4, fontWeight: 600,
          }}
        >
          {generating ? "Generating..." : "Generate .xcs"}
        </button>
        {errorMessage && (
          <div style={{ marginTop: 8, color: "#a02840", fontSize: 12 }}>{errorMessage}</div>
        )}
      </div>

      {/* RIGHT: preview */}
      <div style={{ overflow: "auto", padding: 16, background: "#f6f7f9" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: "#666", marginBottom: 8 }}>
          Preview
        </div>
        <div
          style={{
            background: "white", border: "1px solid #ddd", borderRadius: 4,
            padding: 16, minHeight: 400, display: "flex",
            alignItems: "center", justifyContent: "center",
          }}
        >
          {request.svg_content ? (
            <div
              style={{ maxWidth: "100%", maxHeight: "70vh" }}
              // The SVG content is user-supplied and kept client-side only.
              // dangerouslySetInnerHTML is required to render raw SVG markup.
              dangerouslySetInnerHTML={{ __html: request.svg_content }}
            />
          ) : (
            <div style={{ color: "#999" }}>Upload an SVG to preview</div>
          )}
        </div>
      </div>
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
