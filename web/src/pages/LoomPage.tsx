/**
 * Loom — gradient-hatched fill for a whole artwork.
 *
 * Replaces the old "SVG stack" page (single-layer, N rotated copies —
 * a feature XCS Studio already owns) with something genuinely novel:
 * take any SVG / PNG / JPG as a single silhouette and fill it with
 * hatch lines whose parameters ramp across the shape. Where SVG Layers
 * configures a hatch per detected colour, Loom treats the whole
 * artwork as one shape and gives the hatch a multi-stop gradient
 * editor with a live scrub-bar preview.
 *
 * Uses the existing ``/api/svg-layers`` endpoint under the hood — we
 * rewrite all fills in the uploaded SVG to a single colour client-
 * side, then send exactly one ``LayerSpec`` with the user's
 * ``HatchPass`` configuration. No new backend endpoint required.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Play, Upload, Wand2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  MetalBar,
  NumberField,
  PageContainer,
  Section,
  Select,
} from "../ui";
import type {
  BaseParams,
  HatchPassSpec as HatchPass,
  HatchRampSpec as HatchRamp,
  LayerSpec,
  SvgLayersRequest,
} from "../types";
import { defaultBaseParams } from "../defaults";
import { sanitiseProjectName } from "../projectName";
import type { LibraryState } from "../library";
import { clampToConstraint } from "../lib/constraints";
import type { FieldConstraint } from "../types";
import { listMaterials, listPresets } from "../api/library";
import { getCurrentMachineId, useCurrentMachine, getValidationProfile, representativeMode } from "../state/machine";
import { MaterialPresetPicker } from "../components/MaterialPresetPicker";
import { HatchPassesEditor } from "../components/HatchPassesEditor";
import { BaseParamsEditor } from "../components/BaseParamsEditor";
import { svgLayersAndDownload } from "../generate";
import { traceImageToSvg } from "../tracer/vtracer";
import { DEFAULT_RASTER_TRACE_OPTIONS, type RasterTraceOptions } from "../generate";

/* ========================================================================
 * Types + helpers
 * ====================================================================== */

type UploadKind = "svg" | "raster" | null;

interface Silhouette {
  kind: "svg" | "raster";
  /** Raw source — only kept so we can re-trace if the user changes
   *  vtracer knobs. */
  rasterDataUrl: string | null;
  /** The SVG string the preview + generator both consume. All fill
   *  colours have been collapsed to the Loom accent so downstream
   *  logic treats the artwork as one shape. */
  svgContent: string;
  /** Source filename (for the download). */
  filename: string;
}

/** Loom's single fill colour — matches ``LOOM_ACCENT`` used in the
 *  preview strokes. Using the primary orange gives the preview a
 *  deliberately "it's a plate on the press" feel. */
const LOOM_COLOR = "#b8410e"; // var(--color-primary)

/* Rewrite every fill + stroke attribute in an SVG to ``LOOM_COLOR``
 * so the backend sees exactly one colour → exactly one layer. Works
 * on both inline ``fill=``/``stroke=`` attributes and the ``style=``
 * shorthand. A small ``<style>`` override suppresses any CSS that
 * would otherwise recolour things. */
/** Extract only shape elements (with their nested groups + transforms)
 *  from an SVG, returning a string safe to embed inside another `<g>`
 *  or `<clipPath>`. Drops `<defs>`, `<metadata>`, and all Inkscape
 *  namespaced elements that either contribute nothing or trip up
 *  browsers when inside a clipPath. */
function extractShapes(svgText: string): string {
  try {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== "svg") return svgText;
    // Drop non-shape helpers so the clipPath sees only geometry.
    root.querySelectorAll("defs, metadata, title, desc").forEach((n) => n.remove());
    // Inkscape's sodipodi:namedview has no real equivalent in web SVG.
    [...root.querySelectorAll("*")].forEach((n) => {
      if (n.tagName.includes(":") || n.nodeName.includes("sodipodi")) {
        n.remove();
      }
    });
    // Serialize children — we don't want the outer <svg> wrapper.
    return [...root.children]
      .map((c) => new XMLSerializer().serializeToString(c))
      .join("");
  } catch {
    return svgText;
  }
}

/** Prepare a silhouette fragment for re-embedding inside a `<g>` with
 *  group-level `fill`/`stroke` overrides. Drops the XML prolog +
 *  `<svg>` tags, and strips inline fill/stroke (both attribute and
 *  `style=""`) so the parent group's values take effect. */
function stripStyles(svgText: string): string {
  let out = extractShapes(svgText)
    .replace(/\sfill="[^"]*"/g, "")
    .replace(/\sstroke="[^"]*"/g, "");
  // Scrub fill/stroke declarations out of style="" but keep the rest
  // (transform, opacity, etc. are still needed for correct layout).
  out = out.replace(/style="([^"]*)"/g, (_m, css) => {
    const cleaned = css
      .split(";")
      .map((s: string) => s.trim())
      .filter((decl: string) => decl.length > 0)
      .filter((decl: string) => {
        const k = decl.split(":")[0].trim().toLowerCase();
        return k !== "fill" && k !== "stroke" && k !== "fill-opacity" && k !== "stroke-opacity";
      })
      .join(";");
    return cleaned ? `style="${cleaned}"` : "";
  });
  return out;
}

function collapseFills(svgText: string): string {
  if (!svgText.trim().startsWith("<")) return svgText;
  let out = svgText;
  // Replace fill=... and stroke=... attributes, preserving non-paint
  // values ("none", "url(#grad)") so gradients + stroke-only shapes
  // still render correctly.
  out = out.replace(/\sfill="[^"]*"/g, (match) => {
    const val = match.match(/"([^"]*)"/)?.[1] ?? "";
    if (val === "none" || val.startsWith("url(")) return match;
    return ` fill="${LOOM_COLOR}"`;
  });
  out = out.replace(/\sstroke="[^"]*"/g, (match) => {
    const val = match.match(/"([^"]*)"/)?.[1] ?? "";
    if (val === "none" || val.startsWith("url(")) return match;
    return ` stroke="${LOOM_COLOR}"`;
  });
  // style="fill:..." and style="stroke:..."
  out = out.replace(/fill:\s*#[0-9a-fA-F]{3,8}/g, `fill:${LOOM_COLOR}`);
  out = out.replace(/stroke:\s*#[0-9a-fA-F]{3,8}/g, `stroke:${LOOM_COLOR}`);
  return out;
}

/** Read a File as a data URL (for raster) or text (for SVG). */
function readFile(file: File, mode: "dataUrl" | "text"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    if (mode === "dataUrl") reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

/* ========================================================================
 * Gradient model — local wrapper over HatchRamp's multi-stop shape
 * ====================================================================== */

interface GradientStop {
  id: string;
  position: number; // 0..1
  value: number;
}

interface RampState {
  id: string;
  param: HatchRamp["param"];
  axis: HatchRamp["axis"];
  stops: GradientStop[];
}

/** Burn-intensity colour ramp used by the preview hatch AND the
 *  legend below it. Bone-white → Loom orange → near-black so even
 *  small shifts in the normalised intensity produce a visible colour
 *  change. Pushed more aggressive than a pure pale→dark ramp so
 *  tightly-clustered ramp values still read. */
const LOOM_RAMP_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [248, 232, 218]],   // #F8E8DA — near-white, barely kissed
  [0.25, [230, 156, 94]],   // #E69C5E — golden ember
  [0.55, [184, 65, 14]],    // #B8410E — Loom brand orange
  [0.8, [90, 32, 12]],      // #5A200C — charred
  [1.0, [20, 6, 4]],        // #140604 — near-black deep burn
];

function rampColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 0; i < LOOM_RAMP_STOPS.length - 1; i++) {
    const [a, ca] = LOOM_RAMP_STOPS[i];
    const [b, cb] = LOOM_RAMP_STOPS[i + 1];
    if (c <= b) {
      const span = b - a;
      const k = span > 0 ? (c - a) / span : 0;
      const [r, g, bl] = [0, 1, 2].map((j) => Math.round(ca[j] + k * (cb[j] - ca[j])));
      return `rgb(${r},${g},${bl})`;
    }
  }
  const [r, g, bl] = LOOM_RAMP_STOPS[LOOM_RAMP_STOPS.length - 1][1];
  return `rgb(${r},${g},${bl})`;
}

let _rampIdCounter = 0;
function makeRampId() {
  _rampIdCounter += 1;
  return `ramp-${_rampIdCounter}`;
}
let _stopIdCounter = 0;
function makeStopId() {
  _stopIdCounter += 1;
  return `stop-${_stopIdCounter}`;
}

/** Interpolate a RampState at `pos` — used for the preview, not the
 *  generator (backend has its own piecewise-linear evaluator). */
function rampValueAt(r: RampState, pos: number): number {
  const stops = [...r.stops].sort((a, b) => a.position - b.position);
  if (pos <= stops[0].position) return stops[0].value;
  if (pos >= stops[stops.length - 1].position) return stops[stops.length - 1].value;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (a.position <= pos && pos <= b.position) {
      const span = b.position - a.position;
      if (span <= 0) return a.value;
      const t = (pos - a.position) / span;
      return a.value + t * (b.value - a.value);
    }
  }
  return stops[stops.length - 1].value;
}

/* ========================================================================
 * Page
 * ====================================================================== */

export function LoomPage() {
  // Track the machine that was active when library data was fetched so
  // the generate guard can detect stale context (machine switch without
  // a full page reload, which the MachineSwitcher normally enforces).
  const loadedMachineIdRef = useRef<string>(getCurrentMachineId());

  const { registry, machineId, machine } = useCurrentMachine();
  const loomProfile = getValidationProfile(
    registry, machineId, machine ? representativeMode(machine) : "engrave",
  );

  const [library, setLibrary] = useState<LibraryState>({
    materials: [],
    presets: [],
    active_material_id: null,
  });
  useEffect(() => {
    loadedMachineIdRef.current = getCurrentMachineId();
    Promise.all([listMaterials(), listPresets(undefined, getCurrentMachineId())])
      .then(([mats, pres]) => {
        setLibrary({
          materials: mats,
          presets: pres,
          active_material_id: mats[0]?.id ?? null,
        });
      })
      .catch(() => {});
  }, []);

  const [silhouette, setSilhouette] = useState<Silhouette | null>(null);
  const [uploadKind, setUploadKind] = useState<UploadKind>(null);
  const [tracing, setTracing] = useState(false);
  const [traceOptions, setTraceOptions] = useState<RasterTraceOptions>(() => ({
    ...DEFAULT_RASTER_TRACE_OPTIONS,
    max_colors: 0, // Loom is silhouette-first; max_colors=0 = no pre-quantise
  }));
  const [error, setError] = useState<string | undefined>();
  const [generating, setGenerating] = useState(false);

  // Loom state
  const [widthMm, setWidthMm] = useState(50);
  const [baseParams, setBaseParams] = useState<BaseParams>(() => defaultBaseParams());
  const [materialId, setMaterialId] = useState<string | null>(null);
  useEffect(() => {
    if (materialId == null && library.active_material_id != null) {
      setMaterialId(String(library.active_material_id));
    }
  }, [library.active_material_id, materialId]);

  const [angle, setAngle] = useState(45);
  const [thickness, setThickness] = useState(0.15);
  // Default spacing == thickness so the hatch reads as a solid fill at
  // burn time. Increase spacing to see discrete lines.
  const [spacing, setSpacing] = useState(0.15);
  const [ramp, setRamp] = useState<RampState>(() => ({
    id: makeRampId(),
    param: "power",
    axis: "perp",
    stops: [
      { id: makeStopId(), position: 0, value: 20 },
      { id: makeStopId(), position: 1, value: 80 },
    ],
  }));

  // Scrub bar (0..1) — preview only; doesn't affect generate. Starts
  // near zero so the silhouette is empty and the user can drag to
  // reveal the hatch progressively (or hit play for auto-scrub).
  const [scrub, setScrub] = useState(0.01);
  const [autoScrub, setAutoScrub] = useState(false);
  useEffect(() => {
    if (!autoScrub) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setScrub((s) => {
        const next = s + dt * 0.5; // ~2s to cross
        return next > 1 ? 0 : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoScrub]);

  const accept = ".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFilePicked = useCallback(async (file: File) => {
    setError(undefined);
    try {
      if (file.type.includes("svg") || file.name.toLowerCase().endsWith(".svg")) {
        setUploadKind("svg");
        const text = await readFile(file, "text");
        setSilhouette({
          kind: "svg",
          rasterDataUrl: null,
          svgContent: collapseFills(text),
          filename: sanitiseProjectName(file.name, "loom"),
        });
      } else {
        setUploadKind("raster");
        const dataUrl = await readFile(file, "dataUrl");
        setTracing(true);
        // Run in the next tick so the "tracing…" state paints first.
        setTimeout(async () => {
          try {
            const svg = await traceImageToSvg(dataUrl, traceOptions);
            setSilhouette({
              kind: "raster",
              rasterDataUrl: dataUrl,
              svgContent: collapseFills(svg),
              filename: sanitiseProjectName(file.name, "loom"),
            });
          } catch (err) {
            setError(`Trace failed: ${(err as Error).message}`);
          } finally {
            setTracing(false);
          }
        }, 16);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [traceOptions]);

  const retrace = useCallback(async () => {
    if (!silhouette || silhouette.kind !== "raster" || !silhouette.rasterDataUrl) return;
    setTracing(true);
    try {
      const svg = await traceImageToSvg(silhouette.rasterDataUrl, traceOptions);
      setSilhouette({
        ...silhouette,
        svgContent: collapseFills(svg),
      });
    } catch (err) {
      setError(`Re-trace failed: ${(err as Error).message}`);
    } finally {
      setTracing(false);
    }
  }, [silhouette, traceOptions]);

  const onGenerate = useCallback(async () => {
    if (!silhouette || !materialId) return;
    // Cross-machine guard: detect if the active machine changed after the
    // library data was loaded (MachineSwitcher normally forces a reload,
    // but guard defensively in case of edge cases).
    const currentMachine = getCurrentMachineId();
    if (loadedMachineIdRef.current !== currentMachine) {
      setError(
        `Cross-machine mix detected (${loadedMachineIdRef.current}, ${currentMachine}). ` +
        `Switch to a single machine in the TopBar before composing.`,
      );
      return;
    }
    setGenerating(true);
    setError(undefined);
    try {
      const sortedStops = [...ramp.stops].sort((a, b) => a.position - b.position);
      const rampOut: HatchRamp = {
        param: ramp.param,
        axis: ramp.axis,
        // Legacy two-point form — kept so the Pydantic field
        // remains satisfied. The backend ignores these when stops
        // are present, so we mirror the first/last for tidiness.
        min: sortedStops[0].value,
        max: sortedStops[sortedStops.length - 1].value,
        stops: sortedStops.map((s) => ({ position: s.position, value: s.value })),
      };
      const pass: HatchPass = {
        angle,
        spacing,
        thickness,
        ramps: [rampOut],
      };
      const layer: LayerSpec = {
        color: LOOM_COLOR,
        name: "loom",
        enabled: true,
        processing_type: "HATCHED_LINES",
        scan_angle: 0, // hatched lines carry their own angle via pass
        base_params: baseParams,
        angle_mode: "fixed",
        crosshatch: false,
        material_id: materialId,
        hatch_passes: [pass],
      };
      const request: SvgLayersRequest = {
        name: silhouette.filename || "loom",
        svg_content: silhouette.svgContent,
        width_mm: widthMm,
        height_mm: null,
        start_x: 10,
        start_y: 10,
        material_id: materialId,
        layers: [layer],
        subtract_overlaps: false,
      };
      await svgLayersAndDownload(request);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [silhouette, materialId, ramp, angle, spacing, thickness, baseParams, widthMm]);

  return (
    <div className="relative min-h-full">
      {/* Diagonal warp backdrop — quiet, always-on brand motif. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--color-ink) 0 1px, transparent 1px 24px)",
        }}
      />
      <PageContainer className="relative py-8 max-w-[1400px]">
        <Masthead
          onGenerate={onGenerate}
          canGenerate={!!silhouette && !!materialId && !generating}
          generating={generating}
        />

        {error && (
          <div className="mb-4 rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_440px] gap-6 items-start">
          {/* ------------- PREVIEW (left, sticky) ------------- */}
          <div className="sticky top-4 self-start">
            {silhouette ? (
              <PreviewFrame
                silhouette={silhouette}
                angle={angle}
                spacing={spacing}
                thickness={thickness}
                ramp={ramp}
                scrub={scrub}
                autoScrub={autoScrub}
                onScrub={setScrub}
                onAutoScrub={setAutoScrub}
              />
            ) : (
              <EmptyLoomFrame
                onPick={() => fileInputRef.current?.click()}
                tracing={tracing}
                kind={uploadKind}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFilePicked(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* ------------- CONTROLS (right, scroll) ------------- */}
          <div className="flex flex-col gap-4">
            <PlateCard
              silhouette={silhouette}
              tracing={tracing}
              onPick={() => fileInputRef.current?.click()}
              traceOptions={traceOptions}
              onChangeTraceOptions={setTraceOptions}
              onRetrace={retrace}
            />

            <Section title="Material" dense>
              <MaterialPresetPicker
                library={library}
                materialId={materialId}
                baseParams={baseParams}
                onApply={(mid, params) => {
                  setMaterialId(mid);
                  setBaseParams({ ...params });
                }}
              />
            </Section>

            <Section
              title="Hatch pass"
              description="Diagonal stripes fill the silhouette. Angle is the stripe direction, thickness is each stripe's width, spacing is the gap between stripe centres."
              dense
            >
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Angle (°)" value={angle} min={0} max={360} integer onChange={setAngle} />
                <NumberField label="Spacing (mm)" value={spacing} min={0.05} onChange={setSpacing} />
                <NumberField label="Thickness (mm)" value={thickness} min={0.01} onChange={setThickness} />
              </div>
            </Section>

            <Section
              title="Parameter ramp"
              description="Pick which laser parameter varies across the shape, then set its values at each end of the ramp. Drag a pill to move it, click the rail to add a stop, drag up to remove."
              dense
            >
              <StopsRail
                ramp={ramp}
                onChange={setRamp}
                profile={loomProfile}
              />
            </Section>

            <Section title="Ramp direction" dense>
              <AxisRose
                angle={angle}
                axis={ramp.axis}
                param={ramp.param}
                onAxisChange={(a) => setRamp({ ...ramp, axis: a })}
              />
            </Section>

            <Section title="Base parameters (fallback)" dense
              description="Used for the parameters that aren't ramped. The ramp overrides these per-line."
            >
              <BaseParamsEditor value={baseParams} onChange={setBaseParams} />
            </Section>

            <Section title="Output" dense>
              <NumberField label="Width (mm)" value={widthMm} min={1} onChange={setWidthMm} />
            </Section>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}

/* ========================================================================
 * Masthead
 * ====================================================================== */

function Masthead({
  onGenerate,
  canGenerate,
  generating,
}: {
  onGenerate: () => void;
  canGenerate: boolean;
  generating: boolean;
}) {
  return (
    <header className="mb-6">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-2">
            <span className="h-px w-5 bg-[color:var(--color-border-strong)]" aria-hidden />
            Loom · vol. 1
          </div>
          <div className="flex items-baseline gap-4 flex-wrap">
            <h1 className="text-[28px] font-semibold leading-[1.1] text-[color:var(--color-ink)]">
              <span>Warp the weave.</span>{" "}
              <em className="not-italic text-[color:var(--color-primary)]">Drift the beam.</em>
            </h1>
            <Badge variant="accent" className="translate-y-[-2px]">silhouette · hatch · ramp</Badge>
          </div>
          <p className="mt-2 text-[13.5px] leading-[1.55] text-[color:var(--color-ink-muted)] max-w-[68ch]">
            Drop a shape, set a hatch angle, tension a gradient across it.
            Every hatch line carries different laser params along the ramp —
            something the xTool editor can't do. Scrub the bar in the preview
            to watch the gradient phase in line by line.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={onGenerate}
          disabled={!canGenerate || generating}
        >
          <Wand2 className="h-4 w-4" />
          {generating ? "Weaving…" : "Generate .xcs"}
        </Button>
      </div>
      <div className="mt-4">
        <MetalBar />
      </div>
    </header>
  );
}

/* ========================================================================
 * Empty / Plate cards
 * ====================================================================== */

function EmptyLoomFrame({
  onPick,
  tracing,
  kind,
}: {
  onPick: () => void;
  tracing: boolean;
  kind: UploadKind;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "group w-full rounded-[12px] border border-dashed",
        "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)]",
        "transition-colors hover:border-[color:var(--color-primary)]/60 hover:bg-[color:var(--color-primary-tint)]/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        "cursor-pointer",
      )}
      style={{ aspectRatio: "4 / 3" }}
    >
      <div className="relative h-full flex flex-col items-center justify-center gap-3">
        {/* Diagonal warp backdrop duplicated for affordance focus */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-30 group-hover:opacity-50 transition-opacity"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, var(--color-border) 0 1px, transparent 1px 18px)",
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[color:var(--color-primary)]">
            <Upload className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
            Load a plate
          </div>
          <div className="text-[16px] font-semibold text-[color:var(--color-ink)]">
            Drop an SVG or raster — become a silhouette.
          </div>
          <div className="text-[12px] text-[color:var(--color-ink-muted)]">
            {tracing
              ? kind === "raster"
                ? "Tracing raster…"
                : "Reading SVG…"
              : "SVG, PNG, JPG — click or drop"}
          </div>
        </div>
      </div>
    </button>
  );
}

function PlateCard({
  silhouette,
  tracing,
  onPick,
  traceOptions,
  onChangeTraceOptions,
  onRetrace,
}: {
  silhouette: Silhouette | null;
  tracing: boolean;
  onPick: () => void;
  traceOptions: RasterTraceOptions;
  onChangeTraceOptions: (v: RasterTraceOptions) => void;
  onRetrace: () => void;
}) {
  return (
    <Section
      title="Plate"
      description={
        silhouette
          ? `1 silhouette · ${silhouette.kind === "raster" ? "traced" : "vector"} · ${silhouette.filename}`
          : "Upload an SVG or raster."
      }
      dense
      actions={
        <Button size="sm" variant={silhouette ? "ghost" : "primary"} onClick={onPick}>
          <Upload className="h-3.5 w-3.5" />
          {silhouette ? "Replace" : "Upload"}
        </Button>
      }
    >
      {silhouette?.kind === "raster" && (
        <div className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
            Tracer knobs
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Max colours"
              help="0 = no pre-quantise. For silhouettes, leave at 0."
              value={traceOptions.max_colors}
              min={0}
              max={32}
              integer
              onChange={(v) => onChangeTraceOptions({ ...traceOptions, max_colors: v })}
            />
            <NumberField
              label="Precision"
              help="vtracer colour bit depth."
              value={traceOptions.color_precision}
              min={1}
              max={8}
              integer
              onChange={(v) => onChangeTraceOptions({ ...traceOptions, color_precision: v })}
            />
            <NumberField
              label="Layer Δ"
              help="Minimum visual distance between output layers."
              value={traceOptions.layer_difference}
              min={0}
              max={128}
              integer
              onChange={(v) => onChangeTraceOptions({ ...traceOptions, layer_difference: v })}
            />
            <NumberField
              label="Speckle"
              help="Drops isolated regions smaller than N pixels."
              value={traceOptions.filter_speckle}
              min={0}
              max={64}
              integer
              onChange={(v) => onChangeTraceOptions({ ...traceOptions, filter_speckle: v })}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={onRetrace} disabled={tracing}>
            <Wand2 className="h-3.5 w-3.5" />
            {tracing ? "Tracing…" : "Re-trace"}
          </Button>
        </div>
      )}
    </Section>
  );
}

/* ========================================================================
 * Preview — silhouette + hatch lines + scrub bar
 * ====================================================================== */

interface Bbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function extractViewBox(svg: string): { width: number; height: number; viewBox: string } {
  // Best-effort parse — if we can't determine dimensions, fall back to
  // 100×100, the SVG's intrinsic sizing will handle the rest.
  const vbMatch = svg.match(/viewBox="([^"]*)"/);
  if (vbMatch) {
    const parts = vbMatch[1].split(/\s+/).map(Number);
    if (parts.length === 4) {
      return { width: parts[2], height: parts[3], viewBox: vbMatch[1] };
    }
  }
  const wMatch = svg.match(/\bwidth="([\d.]+)"/);
  const hMatch = svg.match(/\bheight="([\d.]+)"/);
  const w = wMatch ? Number(wMatch[1]) : 100;
  const h = hMatch ? Number(hMatch[1]) : 100;
  return { width: w, height: h, viewBox: `0 0 ${w} ${h}` };
}

/** Generate a set of hatch-line segments inside ``bbox`` at the given
 *  angle + spacing. Each line is clipped visually to the silhouette
 *  via an SVG ``<clipPath>`` wrapping the whole layer. */
function hatchLines(bbox: Bbox, angle: number, spacing: number): Array<{
  x1: number; y1: number; x2: number; y2: number; pos: number;
}> {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Project every bbox corner onto the perpendicular axis so we know
  // the min / max offset we need to cover.
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const corners = [
    [bbox.x, bbox.y],
    [bbox.x + bbox.w, bbox.y],
    [bbox.x, bbox.y + bbox.h],
    [bbox.x + bbox.w, bbox.y + bbox.h],
  ];
  const projections = corners.map(([x, y]) => (x - cx) * -sin + (y - cy) * cos);
  const offMin = Math.min(...projections);
  const offMax = Math.max(...projections);
  const span = offMax - offMin;
  const overshoot = Math.hypot(bbox.w, bbox.h);
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; pos: number }> = [];
  let i = 0;
  for (let o = offMin; o <= offMax; o += spacing) {
    const lineX = cx + -sin * o;
    const lineY = cy + cos * o;
    const x1 = lineX - cos * overshoot;
    const y1 = lineY - sin * overshoot;
    const x2 = lineX + cos * overshoot;
    const y2 = lineY + sin * overshoot;
    const pos = span > 0 ? (o - offMin) / span : 0;
    lines.push({ x1, y1, x2, y2, pos });
    i += 1;
    if (i > 5000) break; // sanity cap
  }
  return lines;
}

function PreviewFrame({
  silhouette,
  angle,
  spacing,
  ramp,
  scrub,
  autoScrub,
  onScrub,
  onAutoScrub,
}: {
  silhouette: Silhouette;
  angle: number;
  spacing: number;
  /** Physical thickness in mm — not used for preview stroke width
   *  (which scales to viewBox) but kept on the call site for future
   *  thickness-matched ramping. */
  thickness: number;
  ramp: RampState;
  scrub: number;
  autoScrub: boolean;
  onScrub: (v: number) => void;
  onAutoScrub: (v: boolean) => void;
}) {
  const vb = useMemo(() => extractViewBox(silhouette.svgContent), [silhouette.svgContent]);
  const bbox: Bbox = { x: 0, y: 0, w: vb.width, h: vb.height };
  // Spacing is in user's mm; the preview SVG units are whatever the
  // source SVG uses. We scale the spacing so a single hatch line is
  // visible at roughly 1/250 of the bbox width.
  const previewSpacing = Math.max(vb.width, vb.height) * (spacing / 50);
  const lines = useMemo(
    () => hatchLines(bbox, angle, previewSpacing),
    [bbox.w, bbox.h, angle, previewSpacing],
  );

  // Stroke width baseline: a thin line against the shape's own scale,
  // not the mm-thickness (which becomes sub-pixel on a 200-wide viewBox).
  const strokeBase = Math.max(vb.width, vb.height) / 400;

  // Normalise a ramp position to "burn intensity" [0..1] — takes the
  // ramp's min/max values so the colour spans the full range regardless
  // of what absolute numbers the user picks. Speed/spacing invert
  // (higher value = lighter mark).
  const normAt = useCallback((pos: number) => {
    const value = rampValueAt(ramp, pos);
    const stops = [...ramp.stops].sort((a, b) => a.position - b.position);
    const lo = Math.min(...stops.map((s) => s.value));
    const hi = Math.max(...stops.map((s) => s.value));
    const norm = hi > lo ? (value - lo) / (hi - lo) : 0.5;
    const invert = ramp.param === "speed" || ramp.param === "spacing";
    return invert ? 1 - norm : norm;
  }, [ramp]);

  // Direction vector of the ramp axis + the bbox projection bounds
  // onto it. We use this to compute each segment's axis position so
  // the preview colours/width vary in whichever direction the user
  // picked (x / y / parallel / perp).
  const axisInfo = useMemo(() => {
    const rad = (angle * Math.PI) / 180;
    let dir: [number, number];
    switch (ramp.axis) {
      case "parallel": dir = [Math.cos(rad), Math.sin(rad)]; break;
      case "x":        dir = [1, 0]; break;
      case "y":        dir = [0, 1]; break;
      default:         dir = [-Math.sin(rad), Math.cos(rad)]; break; // perp
    }
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const corners: [number, number][] = [
      [bbox.x, bbox.y],
      [bbox.x + bbox.w, bbox.y],
      [bbox.x, bbox.y + bbox.h],
      [bbox.x + bbox.w, bbox.y + bbox.h],
    ];
    const projs = corners.map(([x, y]) => (x - cx) * dir[0] + (y - cy) * dir[1]);
    const lo = Math.min(...projs);
    const hi = Math.max(...projs);
    return { dir, cx, cy, lo, hi, span: hi - lo || 1 };
  }, [ramp.axis, angle, bbox.x, bbox.y, bbox.w, bbox.h]);

  const axisPosAt = useCallback(
    (x: number, y: number): number => {
      const { dir, cx, cy, lo, span } = axisInfo;
      const p = (x - cx) * dir[0] + (y - cy) * dir[1];
      return Math.max(0, Math.min(1, (p - lo) / span));
    },
    [axisInfo],
  );

  // Per-line intensity is uniform only when the axis is perpendicular
  // to the hatch (every point on a hatch line sits at the same perp
  // offset). For other axes the colour/width must vary ALONG the
  // line, so we subdivide it into K short segments.
  const subdivisions = ramp.axis === "perp" ? 1 : 14;

  // Build flat segment list once per input change. Each segment is a
  // tiny line with its own axis position → colour → stroke width.
  const segments = useMemo(() => {
    type Seg = { x1: number; y1: number; x2: number; y2: number; pos: number };
    const out: Seg[] = [];
    for (const ln of lines) {
      for (let k = 0; k < subdivisions; k++) {
        const t0 = k / subdivisions;
        const t1 = (k + 1) / subdivisions;
        const midT = (t0 + t1) / 2;
        const midX = ln.x1 + (ln.x2 - ln.x1) * midT;
        const midY = ln.y1 + (ln.y2 - ln.y1) * midT;
        const pos = ramp.axis === "perp" ? ln.pos : axisPosAt(midX, midY);
        out.push({
          x1: ln.x1 + (ln.x2 - ln.x1) * t0,
          y1: ln.y1 + (ln.y2 - ln.y1) * t0,
          x2: ln.x1 + (ln.x2 - ln.x1) * t1,
          y2: ln.y1 + (ln.y2 - ln.y1) * t1,
          pos,
        });
      }
    }
    return out;
  }, [lines, subdivisions, ramp.axis, axisPosAt]);

  // Map a ramp position to colour + stroke-width for the preview.
  const mapLine = useCallback((pos: number) => {
    const t = normAt(pos);
    return {
      color: rampColor(t),
      // 0.25×→4× range: dramatic thickness swing so even small value
      // differences visibly change line weight.
      strokeWidth: strokeBase * (0.25 + t * 3.75),
    };
  }, [normAt, strokeBase]);

  const svgId = useMemo(() => "loom-" + Math.random().toString(36).slice(2, 9), []);

  return (
    <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          Preview · {lines.length} lines · {ramp.param} · along {ramp.axis}
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)]">
          {vb.width.toFixed(0)} × {vb.height.toFixed(0)}
        </span>
      </div>
      <div
        className="relative overflow-hidden rounded-[8px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] mx-auto"
        style={{
          aspectRatio: `${vb.width} / ${vb.height}`,
          // Cap at viewport height (minus chrome) so portrait artwork
          // doesn't push the controls off-screen. Width follows the
          // aspect ratio so the box always fits its parent column.
          maxHeight: "calc(100vh - 260px)",
          maxWidth: "100%",
        }}
      >
        <svg
          viewBox={vb.viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
        >
          {/* `<mask>` instead of `<clipPath>` because complex Inkscape
           *  SVGs with nested transforms render reliably inside mask
           *  but confuse clipPath region computation in Chromium. The
           *  mask paints the silhouette white on a black background —
           *  the hatch group below shows only where the mask is white. */}
          <defs
            dangerouslySetInnerHTML={{
              __html:
                `<mask id="${svgId}-mask" maskUnits="userSpaceOnUse" ` +
                `x="0" y="0" width="${vb.width}" height="${vb.height}">` +
                `<rect x="0" y="0" width="${vb.width}" height="${vb.height}" fill="black"/>` +
                `<g fill="white" stroke="none">${stripStyles(silhouette.svgContent)}</g>` +
                `</mask>`,
            }}
          />
          {/* Neutral ink wash so an un-drawn corner of the hatch still
           *  reads as the silhouette rather than blank canvas. Kept
           *  grayscale so the orange hatch pops on top. stripStyles()
           *  clears inline fill/stroke declarations that would
           *  otherwise override this group's fill. */}
          <g
            fill="var(--color-ink)"
            opacity={0.05}
            dangerouslySetInnerHTML={{
              __html: stripStyles(silhouette.svgContent),
            }}
          />
          {/* Hatch segments masked to silhouette. Each segment is
           *  coloured by its position along the ramp axis, so the
           *  gradient runs in whichever direction the user picked
           *  (perp / parallel / x / y). */}
          <g mask={`url(#${svgId}-mask)`}>
            {segments.map((sg, i) => {
              if (sg.pos > scrub + 0.005) return null;
              const { color, strokeWidth } = mapLine(sg.pos);
              return (
                <line
                  key={i}
                  x1={sg.x1}
                  y1={sg.y1}
                  x2={sg.x2}
                  y2={sg.y2}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeLinecap="butt"
                />
              );
            })}
          </g>
          {/* Silhouette outline on top so the shape reads. stripStyles()
           *  is essential here — without it, inline fill:#xxx overrides
           *  fill="none" and paints a solid silhouette over the hatch. */}
          <g
            fill="none"
            stroke="var(--color-ink)"
            strokeOpacity={0.45}
            strokeWidth={Math.max(vb.width, vb.height) / 500}
            dangerouslySetInnerHTML={{
              __html: stripStyles(silhouette.svgContent),
            }}
          />
        </svg>
      </div>

      <Legend ramp={ramp} normAt={normAt} />

      <ScrubBar
        value={scrub}
        onChange={onScrub}
        autoScrub={autoScrub}
        onAutoScrub={onAutoScrub}
      />
    </div>
  );
}

/** Horizontal strip whose colour gradient mirrors what the preview
 *  actually paints — each point along the strip shows the same colour
 *  the hatch line at that position uses in the preview. The numeric
 *  labels at each stop tell the user "this colour = this value". */
function Legend({
  ramp,
  normAt,
}: {
  ramp: RampState;
  normAt: (pos: number) => number;
}) {
  const stops = useMemo(
    () => [...ramp.stops].sort((a, b) => a.position - b.position),
    [ramp.stops],
  );
  const meta = RAMP_PARAMS.find((m) => m.value === ramp.param);
  const unit = meta?.unit ?? "";
  const label = meta?.label ?? ramp.param;
  const invert = ramp.param === "speed" || ramp.param === "spacing";

  // Sample the piecewise-linear ramp at every stop + intermediate
  // points so the CSS gradient matches the preview's per-line colour
  // rather than a plain 0→1 sweep. Without this, a ramp like
  // [10, 0, 0, 23] would misleadingly show a full dark→light sweep
  // in the legend when the preview is mostly pale.
  const gradStops = useMemo(() => {
    const samples: Array<{ p: number; t: number }> = [];
    // Sample densely between each adjacent stop pair so non-monotonic
    // ramps read correctly.
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      const segSamples = 6;
      for (let j = 0; j <= segSamples; j++) {
        const f = j / segSamples;
        const p = a.position + (b.position - a.position) * f;
        samples.push({ p, t: normAt(p) });
      }
    }
    return samples.map((s) => `${rampColor(s.t)} ${(s.p * 100).toFixed(1)}%`);
  }, [stops, normAt]);

  return (
    <div className="mt-3 rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
      <div className="flex items-baseline justify-between text-[10px] font-mono uppercase tracking-[0.12em] text-[color:var(--color-ink-subtle)]">
        <span>{label} ramp</span>
        <span className="text-[color:var(--color-ink-muted)] normal-case tracking-normal">
          {invert
            ? "higher value → lighter mark"
            : "higher value → darker mark"}
        </span>
      </div>
      <div
        className="relative mt-1 h-3 rounded-full border border-[color:var(--color-border-strong)]"
        style={{
          backgroundImage: `linear-gradient(90deg, ${gradStops.join(",")})`,
        }}
      >
        {/* Tick marks at each stop — full-height so they read as part
         *  of the gradient axis. */}
        {stops.map((s) => (
          <span
            key={s.id}
            aria-hidden
            className="absolute top-[-2px] h-[16px] w-px bg-[color:var(--color-ink)]/60"
            style={{ left: `${(s.position * 100).toFixed(2)}%` }}
          />
        ))}
      </div>
      {/* Per-stop value labels anchored to each tick. First/last use
       *  edge alignment so they don't overflow the container; inner
       *  stops are centred. */}
      <div className="relative mt-1 h-4">
        {stops.map((s, i) => {
          const isFirst = i === 0;
          const isLast = i === stops.length - 1;
          const leftPct = s.position * 100;
          return (
            <span
              key={s.id}
              className="absolute top-0 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)] whitespace-nowrap"
              style={{
                left: `${leftPct.toFixed(2)}%`,
                transform: isFirst
                  ? "translateX(0)"
                  : isLast
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
              }}
            >
              {formatValue(s.value)}{unit && ` ${unit}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ScrubBar({
  value,
  onChange,
  autoScrub,
  onAutoScrub,
}: {
  value: number;
  onChange: (v: number) => void;
  autoScrub: boolean;
  onAutoScrub: (v: boolean) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        type="button"
        onClick={() => onAutoScrub(!autoScrub)}
        title={autoScrub ? "Stop auto-scrub" : "Auto-scrub the ramp"}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
          autoScrub
            ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
            : "border-[color:var(--color-border-strong)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
        )}
      >
        <Play className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={value}
        onChange={(e) => { onAutoScrub(false); onChange(Number(e.target.value)); }}
        className="flex-1"
      />
      <span className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)] min-w-[3ch] text-right">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/* ========================================================================
 * Stops Rail — draggable pills on a rail, multi-stop
 * ====================================================================== */

const RAMP_PARAMS: { value: HatchRamp["param"]; label: string; unit: string }[] = [
  { value: "power",      label: "Power",      unit: "%" },
  { value: "speed",      label: "Speed",      unit: "mm/s" },
  { value: "frequency",  label: "Frequency",  unit: "kHz" },
  { value: "density",    label: "Density",    unit: "l/cm" },
  { value: "passes",     label: "Passes",     unit: "×" },
  { value: "pulse_width", label: "Pulse",     unit: "ns" },
  { value: "spacing",    label: "Spacing",    unit: "mm" },
];

// The profile constraint for a ramp param, or null for params outside the
// profile vocabulary (e.g. "spacing", which is hatch-specific).
function rampConstraint(
  profile: ReturnType<typeof getValidationProfile>,
  param: HatchRamp["param"],
): FieldConstraint | null {
  if (!profile || param === "spacing") return null;
  const c = profile[param];
  return c && c.kind !== "not_applicable" ? c : null;
}

// Ramp params selectable for the active profile: spacing always; others only
// when the profile has them and they aren't not_applicable.
function applicableRampParams(profile: ReturnType<typeof getValidationProfile>) {
  return RAMP_PARAMS.filter(
    (p) => p.value === "spacing" || (!!profile && profile[p.value] && profile[p.value].kind !== "not_applicable"),
  );
}

function StopsRail({
  ramp,
  onChange,
  profile,
}: {
  ramp: RampState;
  onChange: (r: RampState) => void;
  profile: ReturnType<typeof getValidationProfile>;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Constraint for the currently-selected ramp param (null for spacing or
  // params not in the active profile).
  const constraint = rampConstraint(profile, ramp.param);

  const sortedStops = useMemo(() => [...ramp.stops].sort((a, b) => a.position - b.position), [ramp.stops]);

  const setStop = (id: string, patch: Partial<GradientStop>) => {
    onChange({
      ...ramp,
      stops: ramp.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };
  const removeStop = (id: string) => {
    if (ramp.stops.length <= 2) return; // keep at least 2
    onChange({ ...ramp, stops: ramp.stops.filter((s) => s.id !== id) });
  };

  const paramMeta = RAMP_PARAMS.find((m) => m.value === ramp.param)!;

  const clampStopValue = (rawValue: number): number => {
    if (!constraint) return rawValue;
    return clampToConstraint(rawValue, constraint) as number;
  };

  const addStopAt = (position: number) => {
    const p = Math.max(0, Math.min(1, position));
    const rawV = (() => {
      const sorted = sortedStops;
      if (p <= sorted[0].position) return sorted[0].value;
      if (p >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].value;
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (a.position <= p && p <= b.position) {
          const span = b.position - a.position;
          const t = span > 0 ? (p - a.position) / span : 0;
          return a.value + t * (b.value - a.value);
        }
      }
      return sorted[sorted.length - 1].value;
    })();
    const v = clampStopValue(rawV);
    onChange({
      ...ramp,
      stops: [...ramp.stops, { id: makeStopId(), position: p, value: v }],
    });
  };

  // Global move/up handlers for dragging.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const rail = railRef.current?.getBoundingClientRect();
      if (!rail) return;
      const t = (e.clientX - rail.left) / rail.width;
      const clampedPos = Math.max(0, Math.min(1, t));
      // Drag off the top (more than 40px above the rail) removes the stop.
      if (e.clientY < rail.top - 40 && ramp.stops.length > 2) {
        removeStop(dragging);
        setDragging(null);
        return;
      }
      // Dragging repositions the stop only; its value is independent (set via
      // the double-click prompt) and clamped there + in addStopAt.
      setStop(dragging, { position: clampedPos });
    };
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, ramp, constraint]);

  return (
    <div className="flex flex-col gap-3">
      {/* Param + axis selectors. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Param">
          <Select
            value={ramp.param}
            onChange={(e) => onChange({ ...ramp, param: e.target.value as HatchRamp["param"] })}
          >
            {(profile ? applicableRampParams(profile) : RAMP_PARAMS).map((m) => (
              <option key={m.value} value={m.value}>{m.label} ({m.unit})</option>
            ))}
          </Select>
        </Field>
        <Field label="Axis">
          <Select
            value={ramp.axis}
            onChange={(e) => onChange({ ...ramp, axis: e.target.value as HatchRamp["axis"] })}
          >
            <option value="perp">⊥ perp to hatch</option>
            <option value="parallel">∥ along hatch</option>
            <option value="x">x (bbox)</option>
            <option value="y">y (bbox)</option>
          </Select>
        </Field>
      </div>

      {/* Rail. Background is a gradient whose tone ramps along the
          current param so the visual matches the data. */}
      <div
        ref={railRef}
        className="relative h-16 rounded-[10px] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] select-none"
        onClick={(e) => {
          // Only add a new stop when the click is on the rail itself,
          // not when it bubbled up from a pill.
          if (e.target !== e.currentTarget) return;
          const rail = railRef.current?.getBoundingClientRect();
          if (!rail) return;
          addStopAt((e.clientX - rail.left) / rail.width);
        }}
        style={{
          backgroundImage: railGradient(ramp),
        }}
      >
        {/* Pill for each stop. */}
        {sortedStops.map((s) => {
          const isDragging = dragging === s.id;
          return (
            <div
              key={s.id}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(s.id);
              }}
              onDoubleClick={() => {
                const next = window.prompt(
                  `${paramMeta.label} value (${paramMeta.unit})`,
                  String(s.value),
                );
                if (next != null) {
                  const rawV = Number(next);
                  if (!Number.isNaN(rawV)) {
                    const clamped = constraint ? (clampToConstraint(rawV, constraint) as number) : rawV;
                    setStop(s.id, { value: clamped });
                  }
                }
              }}
              style={{
                left: `calc(${(s.position * 100).toFixed(3)}% - 20px)`,
                cursor: isDragging ? "grabbing" : "grab",
              } as CSSProperties}
              className={cn(
                "absolute top-1 h-[56px] w-[40px] flex flex-col items-center justify-between",
                "rounded-[6px] border bg-[color:var(--color-surface-elevated)]",
                "transition-colors",
                isDragging
                  ? "border-[color:var(--color-primary)] shadow-[0_6px_18px_-4px_rgba(184,65,14,0.55)] z-10"
                  : "border-[color:var(--color-border-strong)]",
              )}
            >
              {/* Triangle pointer */}
              <svg
                viewBox="0 0 14 8"
                width={14}
                height={8}
                className="mt-[2px]"
                aria-hidden
              >
                <polygon
                  points="0,0 14,0 7,8"
                  fill={isDragging ? "var(--color-primary)" : "var(--color-ink)"}
                  opacity={0.85}
                />
              </svg>
              <span
                className="font-mono text-[11px] font-semibold tabular-nums text-[color:var(--color-ink)] leading-none"
                title={`${paramMeta.label} = ${s.value}${paramMeta.unit} @ ${Math.round(s.position * 100)}%`}
              >
                {formatValue(s.value)}
              </span>
              <span className="font-mono text-[8.5px] uppercase tracking-[0.06em] text-[color:var(--color-ink-subtle)] mb-[3px]">
                {paramMeta.unit}
              </span>
            </div>
          );
        })}
      </div>

      {/* Legend + delete tip */}
      <div className="flex items-baseline justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
        <span>Start</span>
        <span className="text-[color:var(--color-ink-muted)]">
          click rail to add · drag up to remove
        </span>
        <span>End</span>
      </div>
    </div>
  );
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/* Build a CSS linear-gradient that visualises the ramp along the rail.
 * For power-like params we map to white→primary; for speed-like we
 * invert; for non-visual ones (frequency / passes / pulse_width) we
 * fall back to a slate-to-primary ramp. */
function railGradient(ramp: RampState): string {
  const sorted = [...ramp.stops].sort((a, b) => a.position - b.position);
  const lo = Math.min(...sorted.map((s) => s.value));
  const hi = Math.max(...sorted.map((s) => s.value));
  const invert = ramp.param === "speed" || ramp.param === "spacing";
  const colorAt = (v: number): string => {
    const norm = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    const t = invert ? 1 - norm : norm;
    const alpha = 0.08 + t * 0.38;
    return `rgba(184, 65, 14, ${alpha.toFixed(3)})`;
  };
  const stops = sorted
    .map((s) => `${colorAt(s.value)} ${(s.position * 100).toFixed(1)}%`)
    .join(", ");
  return `linear-gradient(to right, ${stops})`;
}

/* ========================================================================
 * Axis rose
 * ====================================================================== */

function AxisRose({
  angle,
  axis,
  param,
  onAxisChange,
}: {
  angle: number;
  axis: HatchRamp["axis"];
  param: HatchRamp["param"];
  onAxisChange: (a: HatchRamp["axis"]) => void;
}) {
  const axes: Array<{ id: HatchRamp["axis"]; label: string; angleDeg: number }> = [
    { id: "parallel", label: "∥", angleDeg: angle },
    { id: "perp",     label: "⊥", angleDeg: angle + 90 },
    { id: "x",        label: "X", angleDeg: 0 },
    { id: "y",        label: "Y", angleDeg: 90 },
  ];

  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
      <div className="flex items-center gap-4">
        <svg viewBox="-60 -60 120 120" className="w-[120px] h-[120px] shrink-0">
          <circle cx={0} cy={0} r={52} fill="none" stroke="var(--color-border-strong)" strokeWidth={0.8} />
          <circle cx={0} cy={0} r={40} fill="none" stroke="var(--color-border)" strokeWidth={0.6} strokeDasharray="2 2" />
          <circle cx={0} cy={0} r={3} fill="var(--color-ink)" />
          {axes.map((a) => {
            const rad = (a.angleDeg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const x = cos * 46;
            const y = sin * 46;
            const labelX = cos * 56;
            const labelY = sin * 56;
            const isActive = axis === a.id;
            return (
              <g key={a.id} style={{ cursor: "pointer" }} onClick={() => onAxisChange(a.id)}>
                <line
                  x1={0} y1={0} x2={x} y2={y}
                  stroke={isActive ? "var(--color-primary)" : "var(--color-ink-subtle)"}
                  strokeWidth={isActive ? 2.2 : 1.3}
                />
                <circle cx={x} cy={y} r={isActive ? 4 : 3}
                  fill={isActive ? "var(--color-primary)" : "var(--color-surface)"}
                  stroke={isActive ? "var(--color-primary)" : "var(--color-ink-subtle)"} strokeWidth={1.2} />
                <text
                  x={labelX} y={labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{
                    font: isActive ? "bold 9.5px var(--font-mono)" : "8px var(--font-mono)",
                    fill: isActive ? "var(--color-primary)" : "var(--color-ink-muted)",
                  }}
                >
                  {a.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="flex-1 min-w-0 flex flex-col gap-2 text-[12.5px] leading-[1.5] text-[color:var(--color-ink)]">
          <p>
            <strong>{labelForAxis(axis)}</strong> runs{" "}
            <em className="not-italic text-[color:var(--color-primary)]">
              {describeAxisDirection(axis, angle)}
            </em>.
          </p>
          <p className="text-[color:var(--color-ink-muted)] text-[11.5px]">
            {paramDescription(param)}
          </p>
        </div>
      </div>
    </div>
  );
}

function labelForAxis(a: HatchRamp["axis"]): string {
  const map: Record<HatchRamp["axis"], string> = {
    parallel: "∥ parallel",
    perp: "⊥ perpendicular",
    x: "X (horizontal)",
    y: "Y (vertical)",
  };
  return map[a];
}
function describeAxisDirection(a: HatchRamp["axis"], hatchAngle: number): string {
  if (a === "x") return "left → right";
  if (a === "y") return "top → bottom";
  if (a === "perp") return `across hatches (${hatchAngle + 90}°)`;
  return `along hatches (${hatchAngle}°)`;
}
function paramDescription(p: HatchRamp["param"]): string {
  switch (p) {
    case "power":       return "Power drifts across the shape — e.g. shallow engrave on one side, deep on the other.";
    case "speed":       return "Speed drifts — slower = more heat per line = darker mark.";
    case "frequency":   return "Frequency drifts — MOPA only; affects mark colour & depth.";
    case "density":     return "Density drifts — lines/cm of the bitmap raster inside each hatch line.";
    case "passes":      return "Pass count drifts — good for building darker bands at high positions.";
    case "pulse_width": return "Pulse width drifts — MOPA only; snaps to the preset list at burn.";
    case "spacing":     return "Hatch spacing drifts — tighter lines on one side, looser on the other.";
  }
  return "";
}

/* Silence unused-imports for components we ship for completeness. */
void Card;
void HatchPassesEditor;
void EmptyState;
