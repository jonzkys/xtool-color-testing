import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileCode2, Upload } from "lucide-react";
import { defaultBaseParams } from "../defaults";
import { svgStackAndDownload } from "../generate";
import type { SvgProcessingType, SvgStackRequest } from "../types";
import type { LibraryState } from "../library";
import { listMaterials, listPresets } from "../api/library";
import { MaterialPresetPicker } from "./MaterialPresetPicker";
import { PulseWidthSelect } from "./PulseWidthSelect";
import {
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  Input,
  NumberField,
  PageContainer,
  Section,
  Select,
} from "../ui";

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
    material_id: "",
    subtract_overlaps: false,
  };
}

export function SvgStackPage() {
  const [library, setLibrary] = useState<LibraryState>({
    materials: [],
    presets: [],
    active_material_id: null,
  });

  useEffect(() => {
    Promise.all([listMaterials(), listPresets()])
      .then(([mats, pres]) => {
        setLibrary({
          materials: mats,
          presets: pres,
          active_material_id: mats[0]?.id ?? null,
        });
      })
      .catch((e) => console.error("Failed to load library:", e));
  }, []);

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
    const suggested =
      file.name
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

  const disabled = !request.svg_content || !request.material_id || generating;
  const previewHtml = useMemo(() => ({ __html: request.svg_content }), [request.svg_content]);

  return (
    <PageContainer className="py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
            SVG stack
          </div>
          <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
            Single-layer SVG crosshatch
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
            Every shape is engraved with one parameter bundle, re-rendered{" "}
            <span className="font-medium">N</span> times with scan-angle rotation
            between passes — crosshatch for richer fills, stacked passes for
            depth.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6">
        {/* LEFT: form */}
        <div className="flex flex-col gap-5">
          <Section title="SVG">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className={cn(
                "rounded-[10px] border border-dashed",
                "px-4 py-6 text-center cursor-pointer transition-colors",
                filename
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)]/60 text-[color:var(--color-primary)]"
                  : "border-[color:var(--color-border-strong)] hover:border-[color:var(--color-primary)] text-[color:var(--color-ink-muted)]",
              )}
            >
              <div className="flex items-center justify-center gap-2 text-[13px]">
                {filename ? (
                  <FileCode2 className="h-4 w-4" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {filename ?? "Drop an SVG here, or click to browse"}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,image/svg+xml"
              onChange={onFileChange}
              className="hidden"
            />
            <Field label="Output filename">
              <Input
                value={request.name}
                onChange={(e) => updateReq({ name: e.target.value })}
              />
            </Field>
          </Section>

          <Section title="Layout">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Width (mm)"
                value={request.width_mm}
                onChange={(v) => updateReq({ width_mm: v })}
              />
              <Field label="Height (mm)" hint="blank = aspect ratio">
                <Input
                  mono
                  type="number"
                  value={request.height_mm ?? ""}
                  step="any"
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateReq({ height_mm: raw === "" ? null : parseFloat(raw) });
                  }}
                />
              </Field>
              <NumberField
                label="Start X (mm)"
                value={request.start_x}
                onChange={(v) => updateReq({ start_x: v })}
              />
              <NumberField
                label="Start Y (mm)"
                value={request.start_y}
                onChange={(v) => updateReq({ start_y: v })}
              />
            </div>
          </Section>

          <Section title="Processing">
            <Field label="Processing type">
              <Select
                value={request.processing_type}
                onChange={(e) =>
                  updateReq({ processing_type: e.target.value as SvgProcessingType })
                }
              >
                {PROCESSING_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <NumberField
              label="Scan angle (°) — base pass"
              value={request.scan_angle}
              onChange={(v) => updateReq({ scan_angle: v })}
            />
          </Section>

          <Section title="Stacking / crosshatch">
            <div className="grid grid-cols-2 gap-3">
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
            </div>
          </Section>

          <Section title="Layer overlaps">
            <label className="flex items-start gap-2.5 text-[13px]">
              <input
                type="checkbox"
                checked={request.subtract_overlaps}
                onChange={(e) => updateReq({ subtract_overlaps: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="text-[color:var(--color-ink)]">Subtract overlaps</span>
                <p className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
                  Remove areas from lower layers that are covered by higher ones.
                  Each pixel is engraved exactly once — saves time and prevents
                  double-burn artefacts.
                </p>
              </span>
            </label>
          </Section>

          <Section title="Base parameters">
            <MaterialPresetPicker
              library={library}
              materialId={request.material_id}
              baseParams={request.base_params}
              onApply={(materialId, baseParams) => {
                setRequest((prev) => ({
                  ...prev,
                  material_id: materialId,
                  base_params: { ...baseParams },
                }));
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Power %"
                value={request.base_params.power}
                onChange={(v) => updateBase({ power: v })}
              />
              <NumberField
                label="Speed (mm/s)"
                value={request.base_params.speed}
                integer
                onChange={(v) => updateBase({ speed: v })}
              />
              <NumberField
                label="Frequency (Hz)"
                value={request.base_params.frequency}
                integer
                onChange={(v) => updateBase({ frequency: v })}
              />
              <NumberField
                label="Lines/cm"
                value={request.base_params.density}
                integer
                onChange={(v) => updateBase({ density: v })}
              />
              <NumberField
                label="Passes"
                value={request.base_params.passes}
                integer
                min={1}
                onChange={(v) => updateBase({ passes: v })}
              />
              <PulseWidthSelect
                value={request.base_params.pulse_width}
                onChange={(v) => updateBase({ pulse_width: v })}
              />
              <div className="col-span-2">
                <Field label="Laser">
                  <Select
                    value={request.base_params.laser}
                    onChange={(e) =>
                      updateBase({ laser: e.target.value as "red" | "blue" })
                    }
                  >
                    <option value="red">Red (MOPA)</option>
                    <option value="blue">Blue (diode)</option>
                  </Select>
                </Field>
              </div>
            </div>
          </Section>

          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              size="lg"
              onClick={handleGenerate}
              disabled={disabled}
              className="w-full"
            >
              <Download className="h-4 w-4" />
              {generating ? "Generating…" : "Generate .xcs"}
            </Button>
            {errorMessage && (
              <p className="text-[12.5px] text-[color:var(--color-destructive)]">
                {errorMessage}
              </p>
            )}
          </div>
        </div>

        {/* RIGHT: preview */}
        <div className="flex flex-col gap-3 sticky top-4 self-start">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            Preview
          </div>
          <Card variant="inset" padded={false} className="min-h-[380px] flex items-center justify-center">
            {request.svg_content ? (
              <div
                className="w-full h-full max-h-[70vh] flex items-center justify-center p-6 [&>svg]:max-w-full [&>svg]:max-h-[70vh]"
                dangerouslySetInnerHTML={previewHtml}
              />
            ) : (
              <EmptyState
                icon={<FileCode2 className="h-6 w-6" />}
                title="Upload an SVG to preview"
                description="Drop a file on the left, or click the drop zone to browse."
              />
            )}
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
