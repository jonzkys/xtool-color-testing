import { useEffect, useMemo, useRef, useState } from "react";
import {
  Combine,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Filter,
  Layers as LayersIcon,
  Star,
  Upload,
  Wand2,
} from "lucide-react";
import { defaultBaseParams, defaultHatchPass } from "../defaults";
import { PulseWidthSelect } from "./PulseWidthSelect";
import {
  DEFAULT_RASTER_TRACE_OPTIONS,
  previewSvg,
  svgLayersAndDownload,
} from "../generate";
import type { RasterTraceOptions } from "../generate";
// Colour detection runs in the browser via DOMParser + getComputedStyle —
// no round-trip, no backend CPU, same shape as the old API response.
import { detectSvgLayers } from "../svg/detectLayers";
// Tracing runs in the browser via vtracer-wasm — no network roundtrip,
// no backend CPU burn, instant feedback when knobs change.
import { traceImageToSvg } from "../tracer/vtracer";
import type {
  BaseParams,
  DetectedLayer,
  LayerSpec,
  PaletteEntry,
  PaletteQueryResult,
  SvgLayersRequest,
  SvgProcessingType,
} from "../types";
import { HatchPassesEditor } from "./HatchPassesEditor";
import { MergeColorsDialog } from "./MergeColorsDialog";
import { SimplifyShapesDialog } from "./SimplifyShapesDialog";
import type { SimplifyResult } from "../svg/simplify";
import { mergeColorsInSvg, computeParamMergeGroups, type MergeGroup } from "../svg/mergeColors";
import { validateLayerSpec } from "../validation";
import type { LibraryState } from "../library";
import { listMaterials, listPresets } from "../api/library";
import { StarToggle } from "./StarToggle";
import { listPaletteEntries, queryPalette, patchPaletteEntry } from "../api/palette";
import { getCurrentMachineId } from "../state/machine";
import { deltaE2000, hexToLab, type Lab } from "../color/math";
import { computePager } from "../svg/favoritesPager";
import { normalizeColor } from "../svg/color";
import {
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  Field,
  IconButton,
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
  { value: "HATCHED_LINES", label: "Hatched lines" },
];

function seedLayerBaseParams(library: LibraryState) {
  const defaultPreset = library.presets.find(
    (p) => p.material_id === library.active_material_id && p.is_default,
  );
  return defaultPreset
    ? {
        materialId:
          library.active_material_id !== null
            ? String(library.active_material_id)
            : null,
        baseParams: { ...defaultPreset.base_params },
      }
    : { materialId: null as string | null, baseParams: defaultBaseParams() };
}

function defaultLayerFromDetected(
  detected: DetectedLayer,
  library: LibraryState,
): LayerSpec {
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

/** Hue in degrees [0, 360) for an HTML hex string. Returns 0 for greys. */
function hexHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
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
    subtract_overlaps: true,
  };
}

export function SvgLayersPage() {
  const [library, setLibrary] = useState<LibraryState>({
    materials: [],
    presets: [],
    active_material_id: null,
  });

  useEffect(() => {
    Promise.all([listMaterials(), listPresets(undefined, getCurrentMachineId())])
      .then(([mats, pres]) => {
        setLibrary({
          materials: mats,
          presets: pres,
          active_material_id: mats[0]?.id ?? null,
        });
      })
      .catch((e) => console.error("Failed to load library:", e));
  }, []);

  const [request, setRequest] = useState<SvgLayersRequest>(() => defaultRequest(""));
  const [includeNearWhite, setIncludeNearWhite] = useState(false);
  const [rawDetected, setRawDetected] = useState<DetectedLayer[]>([]);
  const [originalSvgContent, setOriginalSvgContent] = useState<string | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [simplifyDialogOpen, setSimplifyDialogOpen] = useState(false);
  // Default off: at first detection every layer carries the same default
  // params, so a default-on collapse silently fuses visually distinct
  // colours into one engrave stage and the "X→1" badge surprises users
  // who haven't picked params yet. Users who want this can opt in.
  const [collapseIdenticalLayers, setCollapseIdenticalLayers] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [isolateSelected, setIsolateSelected] = useState(false);
  const [detectError, setDetectError] = useState<string | undefined>();
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [subtractedSvg, setSubtractedSvg] = useState<string | null>(null);
  const [rasterDataUrl, setRasterDataUrl] = useState<string | null>(null);
  const [traceOptions, setTraceOptions] = useState<RasterTraceOptions>(() => ({
    ...DEFAULT_RASTER_TRACE_OPTIONS,
  }));
  const [tracing, setTracing] = useState(false);
  // True whenever the current traceOptions differ from what produced
  // the displayed SVG. Drives the Re-trace button's "dirty" styling
  // and lets the user see they have unsaved knob changes.
  const [tracePending, setTracePending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [predictedByColor, setPredictedByColor] = useState<Record<string, string>>(
    {},
  );
  type LayerSortKey = "detected" | "hue" | "luminance_light_first" | "luminance_dark_first";
  const [layerSort, setLayerSort] = useState<LayerSortKey>("detected");
  // What the .xcs export uses for layer colours: "original" keeps the
  // detected SVG fills (XCS Studio shows the source colours), "matched"
  // rewrites every fill to the matched palette hex before export so the
  // .xcs canvas reads the palette colours instead.
  type ExportColorMode = "original" | "matched";
  const [exportColorMode, setExportColorMode] = useState<ExportColorMode>("original");
  const [autoApplying, setAutoApplying] = useState(false);
  const [autoApplyMessage, setAutoApplyMessage] = useState<string | undefined>();
  // Cache the full palette per material_id. Auto-match used to fire one
  // /api/palette/query per layer (N parallel requests, each running
  // CIEDE2000 across the whole palette on the server). With the cache we
  // do one /api/palette fetch and run CIEDE2000 locally — zero per-layer
  // server CPU, zero network RTT per layer.
  const paletteCacheRef = useRef<Map<string, PaletteEntry[]>>(new Map());

  const selected = useMemo(
    () => request.layers.find((l) => l.color === selectedColor) ?? null,
    [request.layers, selectedColor],
  );

  const enabledColors = useMemo(
    () => new Set(request.layers.filter((l) => l.enabled).map((l) => l.color)),
    [request.layers],
  );

  const shapeCountsByColor = useMemo(() => {
    const out: Record<string, number> = {};
    for (const d of rawDetected) out[d.color] = d.shape_count;
    return out;
  }, [rawDetected]);
  const totalShapeCount = useMemo(
    () => rawDetected.reduce((n, d) => n + d.shape_count, 0),
    [rawDetected],
  );

  const paramGroups = useMemo(
    () =>
      collapseIdenticalLayers
        ? computeParamMergeGroups(request.layers.filter((l) => l.enabled))
        : [],
    [collapseIdenticalLayers, request.layers],
  );
  const collapseBefore = paramGroups.reduce((n, g) => n + g.length, 0);
  const collapseAfter = paramGroups.length;

  useEffect(() => {
    if (!request.subtract_overlaps || !request.svg_content) {
      setSubtractedSvg(null);
      return;
    }
    // Debounce the preview call: every width/enable-toggle change fires this
    // effect, and /api/svg-preview runs shapely unary_union + difference on
    // the server. Without a delay, dragging a slider queues one request per
    // tick and pegs a backend CPU. 300 ms feels instant to the user and
    // collapses a drag into ~1 request.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      previewSvg(request.svg_content, {
        enabled_colors: [...enabledColors],
        subtract_overlaps: true,
        width_mm: request.width_mm,
      })
        .then((svg) => {
          if (!cancelled) setSubtractedSvg(svg);
        })
        .catch(() => {
          if (!cancelled) setSubtractedSvg(null);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [request.subtract_overlaps, request.svg_content, request.width_mm, enabledColors]);

  useEffect(() => {
    if (rawDetected.length === 0) return;
    const visible = rawDetected.filter((d) => includeNearWhite || !d.is_near_white);
    setRequest((prev) => {
      const byColor = new Map(prev.layers.map((l) => [l.color, l]));
      const nextLayers = visible.map(
        (d) => byColor.get(d.color) ?? defaultLayerFromDetected(d, library),
      );
      return { ...prev, layers: nextLayers };
    });
  }, [includeNearWhite, rawDetected, library]);

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
        l.color === color
          ? { ...l, base_params: { ...l.base_params, ...patch } }
          : l,
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
      const matIdNum = Number(request.material_id);
      const cacheKey = String(matIdNum);
      let palette = paletteCacheRef.current.get(cacheKey);
      if (!palette) {
        palette = await listPaletteEntries({ material_id: matIdNum, machine_id: getCurrentMachineId() });
        paletteCacheRef.current.set(cacheKey, palette);
      }
      const results = request.layers.map((l) => {
        if (!/^#[0-9a-fA-F]{6}$/.test(l.color) || palette!.length === 0) {
          return { layer: l, best: null as PaletteQueryResult | null };
        }
        const target = hexToLab(l.color);
        let bestEntry: PaletteEntry | null = null;
        let bestDelta = Infinity;
        for (const entry of palette!) {
          const entryLab = entry.lab.length >= 3
            ? ([entry.lab[0], entry.lab[1], entry.lab[2]] as Lab)
            : hexToLab(entry.hex);
          const d = deltaE2000(target, entryLab);
          if (d < bestDelta) {
            bestDelta = d;
            bestEntry = entry;
          }
        }
        return {
          layer: l,
          best: bestEntry ? { entry: bestEntry, delta_e: bestDelta } : null,
        };
      });

      let applied = 0;
      let unchanged = 0;
      let noMatch = 0;
      const nextPredicted: Record<string, string> = { ...predictedByColor };
      setRequest((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => {
          const match = results.find((r) => r.layer.color === l.color);
          if (!match?.best) {
            noMatch += 1;
            return l;
          }
          const newParams = paletteParamsToBaseParams(match.best.entry.params);
          // Compare to what's already there: if the predicted hex is the
          // same and base_params already match, this is a no-op.
          const alreadyMatched =
            predictedByColor[l.color] === match.best.entry.hex &&
            (Object.entries(newParams) as [keyof typeof newParams, unknown][])
              .every(([k, v]) => l.base_params[k] === v);
          nextPredicted[l.color] = match.best.entry.hex;
          if (alreadyMatched) {
            unchanged += 1;
            return l;
          }
          applied += 1;
          return { ...l, base_params: { ...l.base_params, ...newParams } };
        }),
      }));
      setPredictedByColor(nextPredicted);

      // Compose a message that distinguishes the three buckets.
      const plural = (n: number) => (n === 1 ? "" : "s");
      const parts: string[] = [];
      if (applied > 0) parts.push(`Applied to ${applied} layer${plural(applied)}`);
      if (unchanged > 0) parts.push(`${unchanged} already matched`);
      if (noMatch > 0) parts.push(`${noMatch} skipped — no palette match`);
      setAutoApplyMessage(
        parts.length === 0 ? "No layers to match." : `${parts.join(" · ")}.`,
      );
    } catch (err) {
      setAutoApplyMessage(`Failed: ${(err as Error).message}`);
    } finally {
      setAutoApplying(false);
    }
  }

  async function handleMergeConfirm(groups: MergeGroup[]) {
    setMergeDialogOpen(false);
    if (groups.length === 0) return;
    setDetectError(undefined);
    try {
      const merged = mergeColorsInSvg(request.svg_content, groups);
      // Snapshot existing layers' state (params, name, enabled,
      // processing_type, hatch_passes, etc.) before re-detect wipes
      // them. The merge UI picks the representative colour from the
      // existing layers, so the representative's old layer is the
      // right source of state for the new (post-merge) layer.
      const inherit = request.layers;
      await applyDetectedSvg(merged, request.name, inherit);
    } catch (err) {
      setDetectError((err as Error).message);
    }
  }

  async function handleResetMerges() {
    if (!originalSvgContent) return;
    setDetectError(undefined);
    try {
      await applyDetectedSvg(originalSvgContent, request.name);
    } catch (err) {
      setDetectError((err as Error).message);
    }
  }

  async function handleSimplifyConfirm(result: SimplifyResult) {
    setSimplifyDialogOpen(false);
    if (result.beforeShapes === result.afterShapes && result.pathsSimplified === 0) {
      return;
    }
    setDetectError(undefined);
    try {
      // Layers' params survive — the colour set may shrink if a
      // tiny-area drop wiped the only shape of some hue, so re-detect
      // and let applyDetectedSvg's inherit pass migrate state by hex.
      await applyDetectedSvg(result.svgText, request.name, request.layers);
    } catch (err) {
      setDetectError((err as Error).message);
    }
  }

  async function applyDetectedSvg(
    svgText: string,
    suggestedName: string,
    inherit?: LayerSpec[],
  ) {
    setRequest((prev) => ({
      ...prev,
      svg_content: svgText,
      name: suggestedName,
      layers: [],
    }));
    try {
      const detected = detectSvgLayers(svgText);
      setRawDetected(detected);
      const visible = detected.filter(
        (d) => includeNearWhite || !d.is_near_white,
      );
      // If a previous layer had this colour (e.g. through a merge that
      // promotes the representative), inherit its full state — params,
      // name, enabled flag, processing type, hatch passes, etc. The
      // re-detect would otherwise reset everything to the default
      // preset and wipe any auto-match work.
      const inheritByColor = inherit
        ? new Map(inherit.map((l) => [l.color, l]))
        : null;
      const layers = visible.map((d) => {
        const prior = inheritByColor?.get(d.color);
        return prior
          ? { ...prior, color: d.color }
          : defaultLayerFromDetected(d, library);
      });
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
      file.name
        .replace(/\.(svg|png|jpe?g)$/i, "")
        .replace(/[^A-Za-z0-9._\- ]/g, "_")
        .slice(0, 64) || "svg-layers";

    const isRaster =
      /\.(png|jpe?g)$/i.test(file.name) || file.type.startsWith("image/");
    const isSvg = /\.svg$/i.test(file.name) || file.type === "image/svg+xml";

    if (isSvg || !isRaster) {
      setRasterDataUrl(null);
      const text = await file.text();
      setOriginalSvgContent(text);
      await applyDetectedSvg(text, suggested);
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    setRasterDataUrl(dataUrl);
    setTracing(true);
    try {
      const svg = await traceImageToSvg(dataUrl, traceOptions);
      setOriginalSvgContent(svg);
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
      const svg = await traceImageToSvg(rasterDataUrl, opts);
      setOriginalSvgContent(svg);
      const currentName = request.name;
      await applyDetectedSvg(svg, currentName);
      setTracePending(false);
    } catch (err) {
      setDetectError((err as Error).message);
    } finally {
      setTracing(false);
    }
  }

  // Knob changes just update local state + mark the trace as stale —
  // they no longer fire a backend request per keystroke. A single
  // invocation of vtracer can take multiple seconds on even modest
  // images, so the previous "trace on every onChange" was eating the
  // backend CPU for breakfast whenever a user scrolled a number field.
  function updateTraceOptions(patch: Partial<RasterTraceOptions>) {
    setTraceOptions({ ...traceOptions, ...patch });
    setTracePending(true);
  }
  function resetTraceOptions() {
    setTraceOptions({ ...DEFAULT_RASTER_TRACE_OPTIONS });
    setTracePending(true);
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
      await svgLayersAndDownload(buildGenerateRequest());
    } catch (err) {
      setErrorMessage((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function buildGenerateRequest(): SvgLayersRequest {
    let r = request;

    // Optional palette-colour rewrite: every detected fill that has a
    // palette match becomes the matched hex in both the SVG content and
    // each LayerSpec.color. Two detected colours that map to the same
    // matched colour collapse into one layer (the backend keys shapes to
    // layers by fill, so duplicate colours need merging).
    if (exportColorMode === "matched" && Object.keys(predictedByColor).length > 0) {
      const matchEntries = Object.entries(predictedByColor)
        .filter(([from, to]) => from !== to);
      if (matchEntries.length > 0) {
        // Group source colours by representative so mergeColorsInSvg can
        // dedupe overlaps and the LayerSpec list stays one-per-rep.
        const byRep = new Map<string, string[]>();
        for (const [from, to] of matchEntries) {
          const list = byRep.get(to) ?? [];
          list.push(from);
          byRep.set(to, list);
        }
        const matchGroups: MergeGroup[] = [];
        for (const [rep, sources] of byRep) {
          // Include the representative itself in the source list — the
          // SVG might also contain shapes at the matched-hex value
          // already (rare, but safe to dedupe through).
          const allSources = sources.includes(rep) ? sources : [...sources, rep];
          matchGroups.push({ sourceColors: allSources, representativeColor: rep });
        }
        const reps = new Set(matchGroups.map((g) => g.representativeColor));
        const losers = new Set(
          matchGroups.flatMap((g) => g.sourceColors.filter((c) => !reps.has(c))),
        );
        const remappedSvg = mergeColorsInSvg(r.svg_content, matchGroups);
        const remappedLayers = r.layers
          .filter((l) => !losers.has(l.color) || reps.has(l.color))
          .map((l) => {
            const matched = predictedByColor[l.color];
            return matched && matched !== l.color ? { ...l, color: matched } : l;
          });
        r = { ...r, svg_content: remappedSvg, layers: remappedLayers };
      }
    }

    if (!collapseIdenticalLayers) return r;
    const groups = computeParamMergeGroups(r.layers.filter((l) => l.enabled));
    if (groups.length === 0) return r;

    const mergeGroups: MergeGroup[] = groups.map((members) => ({
      sourceColors: members.map((m) => m.color),
      representativeColor: members[0].color,
    }));
    const representatives = new Set(mergeGroups.map((g) => g.representativeColor));
    const loserColors = new Set(
      mergeGroups.flatMap((g) => g.sourceColors.filter((c) => c !== g.representativeColor)),
    );

    const collapsedSvg = mergeColorsInSvg(r.svg_content, mergeGroups);
    const collapsedLayers = r.layers.filter(
      (l) => !loserColors.has(l.color) || representatives.has(l.color),
    );
    return { ...r, svg_content: collapsedSvg, layers: collapsedLayers };
  }

  const hasLayers = request.layers.length > 0;
  const hatchedHasErrors = request.layers.some(
    (l, i) =>
      l.enabled &&
      validateLayerSpec(l, i).some((iss) => iss.severity === "error"),
  );
  const disabled =
    !hasLayers ||
    !request.layers.some((l) => l.enabled) ||
    !request.material_id ||
    generating ||
    hatchedHasErrors;

  const hiddenNearWhiteCount = rawDetected.filter((d) => d.is_near_white).length;

  return (
    <PageContainer maxWidth="wide" className="py-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
            SVG layers
          </div>
          <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
            Multi-layer SVG / raster to laser
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
            Upload an SVG or raster; each detected colour becomes a layer you
            can assign processing params, crosshatch passes, or palette-matched
            values to.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div
            role="tablist"
            aria-label="Export colour source"
            title="What colour each layer is labelled with in the .xcs — engrave params come from the layer's base_params either way."
            className="inline-flex items-stretch rounded-[6px] border border-[color:var(--color-border)] overflow-hidden"
          >
            {(["original", "matched"] as const).map((mode) => {
              const active = exportColorMode === mode;
              const matchedDisabled =
                mode === "matched" && Object.keys(predictedByColor).length === 0;
              return (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={matchedDisabled}
                  onClick={() => setExportColorMode(mode)}
                  title={
                    matchedDisabled
                      ? "Apply palette matches first to enable matched-colour export"
                      : mode === "original"
                        ? "Export with detected colours"
                        : "Export with matched palette colours"
                  }
                  className={cn(
                    "px-2.5 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase font-semibold transition-colors",
                    active
                      ? "bg-[color:var(--color-primary)] text-white"
                      : matchedDisabled
                        ? "bg-[color:var(--color-surface)] text-[color:var(--color-ink-subtle)] opacity-50 cursor-not-allowed"
                        : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
                  )}
                >
                  {mode}
                </button>
              );
            })}
          </div>
          <Button
            variant="primary"
            onClick={handleGenerate}
            disabled={disabled}
          >
            <Download className="h-4 w-4" />
            {generating ? "Generating…" : "Generate .xcs"}
          </Button>
        </div>
      </header>

      {errorMessage && (
        <div className="mb-3 rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-[300px_minmax(0,1fr)_360px] gap-4">
        {/* LEFT: source + layers + project */}
        <Card padded={false} className="self-start">
          <div className="flex flex-col gap-4 p-4">
            <Field label="Project material">
              <Select
                value={request.material_id}
                onChange={(e) =>
                  setRequest((prev) => ({ ...prev, material_id: e.target.value }))
                }
                invalid={!request.material_id}
              >
                {!request.material_id && (
                  <option value="">— pick a material —</option>
                )}
                {library.materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className={cn(
                  "rounded-[10px] border border-dashed px-3 py-4 text-center cursor-pointer transition-colors",
                  filename
                    ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary-tint)]/60 text-[color:var(--color-primary)]"
                    : "border-[color:var(--color-border-strong)] hover:border-[color:var(--color-primary)] text-[color:var(--color-ink-muted)]",
                )}
              >
                <div className="flex items-center justify-center gap-2 text-[12.5px]">
                  {filename ? (
                    <FileCode2 className="h-4 w-4" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span className="truncate">
                    {filename ?? "Drop SVG / PNG / JPG, or click"}
                  </span>
                </div>
                {tracing && (
                  <div className="mt-1 text-[10px] text-[color:var(--color-ink-subtle)]">
                    Tracing…
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
                onChange={onFileChange}
                className="hidden"
              />
            </div>

            {detectError && (
              <div className="rounded-[6px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-2.5 py-1.5 text-[12px] text-[color:var(--color-destructive)]">
                {detectError}
              </div>
            )}

            {rasterDataUrl && (
              <Section
                title="Trace options"
                // Keep the description stable across ``tracePending`` so the
                // left sidebar doesn't relayout on every keystroke. Pending
                // state is already signalled by the button's variant swap.
                description="Adjust knobs, then click Re-trace. vtracer is expensive on larger images."
                actions={
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetTraceOptions}
                      disabled={tracing}
                    >
                      Reset
                    </Button>
                    <Button
                      variant={tracePending ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => void retrace(traceOptions)}
                      disabled={tracing || !rasterDataUrl}
                    >
                      {tracing ? "Tracing…" : "Re-trace"}
                    </Button>
                  </div>
                }
                dense
              >
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Max colours"
                    value={traceOptions.max_colors}
                    integer
                    min={0}
                    max={32}
                    onChange={(v) => updateTraceOptions({ max_colors: v })}
                    help="Pre-quantises the image to this many colours via PIL median-cut BEFORE vtracer. 0 disables. Typical: 3–8 clean / 12–24 detail. Capped at 32 — above that vtracer's layer-per-colour work balloons."
                  />
                  <NumberField
                    label="Colour precision"
                    value={traceOptions.color_precision}
                    integer
                    min={1}
                    max={8}
                    onChange={(v) => updateTraceOptions({ color_precision: v })}
                    help="Bit depth vtracer uses internally. Lower = chunkier groups; higher preserves subtle differences. Default 4."
                  />
                  <NumberField
                    label="Layer difference"
                    value={traceOptions.layer_difference}
                    integer
                    min={0}
                    max={128}
                    onChange={(v) => updateTraceOptions({ layer_difference: v })}
                    help="Minimum visual distance between output layers. Higher merges near-identical colours. Default 32; 64–96 for aggressive merging. Capped at 128 — beyond that everything merges into one layer."
                  />
                  <NumberField
                    label="Filter speckle"
                    value={traceOptions.filter_speckle}
                    integer
                    min={0}
                    max={64}
                    onChange={(v) => updateTraceOptions({ filter_speckle: v })}
                    help="Drops isolated regions smaller than N pixels. Kills JPEG / photo-grain noise. Default 8. Capped at 64 — larger drops legitimate detail too."
                  />
                </div>
              </Section>
            )}

            <Section
              title={
                <span className="inline-flex items-center gap-2">
                  <span>
                    Layers
                    {hasLayers
                      ? ` (${request.layers.length}${
                          totalShapeCount > 0
                            ? ` · ${totalShapeCount.toLocaleString()} shapes`
                            : ""
                        })`
                      : ""}
                  </span>
                  {originalSvgContent !== null &&
                    originalSvgContent !== request.svg_content && (
                      <button
                        type="button"
                        onClick={handleResetMerges}
                        title="Reset to detected layers"
                        aria-label="Reset to originally detected layers"
                        className="appearance-none bg-transparent border-0 p-0 cursor-pointer"
                      >
                        <Badge variant="accent" size="sm">merged · reset</Badge>
                      </button>
                    )}
                </span>
              }
              description={
                hasLayers
                  ? "Top = drawn on top. Subtraction removes lower layers where upper ones cover."
                  : undefined
              }
              actions={
                hasLayers ? (
                  <div className="flex items-center gap-1">
                    {totalShapeCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSimplifyDialogOpen(true)}
                        title="Drop tiny artefacts (vtracer often leaves hundreds of single-pixel ones) and reduce vertex count on long polylines. xTool studio gets sluggish past ~1k shapes; this is the most direct fix."
                      >
                        <Filter className="h-4 w-4" />
                        Simplify…
                      </Button>
                    )}
                    {request.layers.length >= 2 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMergeDialogOpen(true)}
                        title="Group near-identical colours into one layer. Rewrites every shape's fill in the SVG to the representative colour, so subtraction and engrave passes treat them as one. Reduces pass count without moving any shapes; same-colour overlaps that result will collapse into a single shape."
                      >
                        <Combine className="h-4 w-4" />
                        Merge similar…
                      </Button>
                    )}
                  </div>
                ) : undefined
              }
              dense
            >
              {hasLayers && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={autoMatchAllLayers}
                  disabled={!request.material_id || autoApplying}
                  title={
                    !request.material_id
                      ? "Pick a material above first"
                      : "Query the palette for each layer's colour and apply the closest match"
                  }
                  className="w-full"
                >
                  <Wand2 className="h-4 w-4" />
                  {autoApplying
                    ? "Matching…"
                    : "Auto-match all layers to palette"}
                </Button>
              )}
              {autoApplyMessage && (
                <p className="text-[11px] text-[color:var(--color-ink-muted)]">
                  {autoApplyMessage}
                </p>
              )}
              {!hasLayers && (
                <p className="text-[12.5px] text-[color:var(--color-ink-subtle)]">
                  Upload an SVG / image to detect layers.
                </p>
              )}
              {hiddenNearWhiteCount > 0 && (
                <label className="flex items-center gap-2 text-[12px] text-[color:var(--color-ink-muted)]">
                  <input
                    type="checkbox"
                    checked={includeNearWhite}
                    onChange={(e) => setIncludeNearWhite(e.target.checked)}
                  />
                  <span>
                    Include white
                    <span className="ml-1 text-[color:var(--color-ink-subtle)]">
                      ({hiddenNearWhiteCount} near-white
                      {hiddenNearWhiteCount === 1 ? "" : "s"} hidden)
                    </span>
                  </span>
                </label>
              )}
              {hasLayers && (
                <label className="flex items-center gap-2 text-[11.5px] text-[color:var(--color-ink-muted)]">
                  Sort
                  <Select
                    value={layerSort}
                    onChange={(e) => setLayerSort(e.target.value as LayerSortKey)}
                    className="h-7 text-[12px] py-0"
                  >
                    <option value="detected">As detected (top → bottom)</option>
                    <option value="hue">Hue</option>
                    <option value="luminance_light_first">Luminance · light → dark</option>
                    <option value="luminance_dark_first">Luminance · dark → light</option>
                  </Select>
                </label>
              )}
              {hasLayers && (
                <ul className="grid grid-cols-2 gap-1.5 max-h-[50vh] overflow-y-auto -mx-1 px-1 pb-1">
                  {(() => {
                    const ls = [...request.layers];
                    if (layerSort === "detected") {
                      ls.reverse(); // last in document = drawn on top = first in list
                    } else if (layerSort === "hue") {
                      ls.sort((a, b) => hexHue(a.color) - hexHue(b.color));
                    } else if (layerSort === "luminance_light_first") {
                      ls.sort((a, b) => hexToLab(b.color)[0] - hexToLab(a.color)[0]);
                    } else if (layerSort === "luminance_dark_first") {
                      ls.sort((a, b) => hexToLab(a.color)[0] - hexToLab(b.color)[0]);
                    }
                    return ls;
                  })().map((l) => {
                    const isSel = selectedColor === l.color;
                    const matched = predictedByColor[l.color];
                    const shapeCount = shapeCountsByColor[l.color] ?? 0;
                    return (
                      <li key={l.color}>
                        <button
                          type="button"
                          onClick={() => setSelectedColor(l.color)}
                          className={cn(
                            "group relative w-full overflow-hidden rounded-[6px]",
                            "border transition-colors text-left",
                            isSel
                              ? "border-[color:var(--color-primary)] ring-1 ring-[color:var(--color-primary)]/40"
                              : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]",
                            !l.enabled && "opacity-50",
                          )}
                          aria-label={`Layer ${l.color}${matched ? `, matched to ${matched}` : ", no palette match"}`}
                        >
                          {/* Top half: detected colour */}
                          <div
                            aria-hidden="true"
                            className="h-10 w-full"
                            style={{ background: l.color }}
                          />
                          {/* Bottom half: matched palette colour, or muted with hint */}
                          <div
                            aria-hidden="true"
                            className="h-10 w-full relative"
                            style={{ background: matched ?? "var(--color-surface-elevated)" }}
                          >
                            {!matched && (
                              <span className="absolute inset-0 flex items-center justify-center font-mono text-[8.5px] tracking-[0.15em] uppercase text-[color:var(--color-ink-subtle)]">
                                no match
                              </span>
                            )}
                          </div>
                          {/* Hex codes + shape count underneath */}
                          <div className="flex items-baseline justify-between gap-1 px-1.5 py-1 bg-[color:var(--color-surface)] border-t border-[color:var(--color-border)]">
                            <span className="font-mono text-[9.5px] text-[color:var(--color-ink)] truncate">
                              {l.color}
                            </span>
                            <span className={cn(
                              "font-mono text-[9.5px] truncate",
                              matched ? "text-[color:var(--color-ink-muted)]" : "text-[color:var(--color-ink-subtle)]/40",
                            )}>
                              {matched ?? "—"}
                            </span>
                          </div>
                          {/* Shape count — quick read on layer complexity.
                              xTool studio gets sluggish past ~1k total
                              shapes, so a per-layer chip helps the user
                              spot the offenders before export. */}
                          {shapeCount > 0 && (
                            <div className="flex items-center justify-end gap-1 px-1.5 pb-1 bg-[color:var(--color-surface)]">
                              <span
                                className="font-mono text-[8.5px] tracking-[0.1em] tabular-nums text-[color:var(--color-ink-subtle)]"
                                title={`${shapeCount} shape${shapeCount === 1 ? "" : "s"} in this layer`}
                              >
                                {shapeCount.toLocaleString()} shape{shapeCount === 1 ? "" : "s"}
                              </span>
                            </div>
                          )}
                          {/* Enable checkbox — top-right corner */}
                          <input
                            type="checkbox"
                            checked={l.enabled}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              updateLayer(l.color, { enabled: e.target.checked })
                            }
                            title={l.enabled ? "Disable layer" : "Enable layer"}
                            className="absolute top-1 right-1 cursor-pointer drop-shadow-[0_0_2px_rgba(0,0,0,0.5)]"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title="Project" dense>
              <Field label="Output filename">
                <Input
                  value={request.name}
                  onChange={(e) => updateReq({ name: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Width (mm)"
                  value={request.width_mm}
                  onChange={(v) => updateReq({ width_mm: v })}
                />
                <Field label="Height (mm)" hint="blank = aspect">
                  <Input
                    mono
                    type="number"
                    value={request.height_mm ?? ""}
                    step="any"
                    onChange={(e) =>
                      updateReq({
                        height_mm:
                          e.target.value === "" ? null : parseFloat(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <label className="flex items-start justify-between gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={collapseIdenticalLayers}
                    onChange={(e) => setCollapseIdenticalLayers(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Collapse identical layers
                    <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
                      Layers with the same params merge into one output.
                    </span>
                  </span>
                </div>
                {collapseAfter > 0 && (
                  <Badge variant="accent" size="sm">{collapseBefore}→{collapseAfter}</Badge>
                )}
              </label>
              <label className="flex items-start gap-2 text-[12.5px] text-[color:var(--color-ink-muted)]">
                <input
                  type="checkbox"
                  checked={request.subtract_overlaps}
                  onChange={(e) => updateReq({ subtract_overlaps: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  Subtract overlaps
                  <span className="block text-[11px] text-[color:var(--color-ink-subtle)]">
                    Where two layers overlap, the top layer (drawn last) wins —
                    the bottom layer's overlap region is erased so the laser
                    never engraves the same patch twice.
                  </span>
                </span>
              </label>
            </Section>
          </div>
        </Card>

        {/* CENTER: selected layer editor */}
        <Card padded={false} className="self-start">
          <div className="p-4">
            {selected ? (
              <LayerEditor
                key={selected.color}
                layer={selected}
                layerIdx={request.layers.findIndex(
                  (l) => l.color === selected.color,
                )}
                projectMaterialId={request.material_id}
                onPatch={(p) => updateLayer(selected.color, p)}
                onBasePatch={(p) => updateBase(selected.color, p)}
                onPaletteApply={(params, hex) =>
                  applyPaletteMatch(selected.color, params, hex)
                }
                appliedHex={predictedByColor[selected.color]}
              />
            ) : (
              <EmptyState
                icon={<LayersIcon className="h-6 w-6" />}
                title="Select a layer"
                description="Pick one from the Layers list on the left to edit its params, processing, or crosshatch."
              />
            )}
          </div>
        </Card>

        {/* RIGHT: previews */}
        <div className="flex flex-col gap-3 self-start sticky top-4 min-w-0">
          <PreviewBlock
            title="Design"
            trailing={
              <IconButton
                aria-label={isolateSelected ? "Show all layers" : "Isolate selected layer"}
                size="sm"
                variant={isolateSelected ? "active" : "default"}
                disabled={!selectedColor}
                icon={
                  isolateSelected ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )
                }
                onClick={() => setIsolateSelected((v) => !v)}
                title={isolateSelected ? "Show all layers" : "Isolate selected layer"}
              />
            }
            subtext={
              isolateSelected && selectedColor ? (
                <span className="font-mono text-[11px] text-[color:var(--color-primary)]">
                  {selectedColor}
                </span>
              ) : undefined
            }
          >
            <SvgPreview
              svg={subtractedSvg ?? request.svg_content}
              highlightColor={isolateSelected ? selectedColor : null}
              enabledColors={enabledColors}
            />
          </PreviewBlock>
          <PreviewBlock
            title="Expected burn"
            subtext={
              Object.keys(predictedByColor).length === 0 ? (
                <span className="text-[color:var(--color-warning)]">
                  Apply palette matches to populate
                </span>
              ) : undefined
            }
          >
            <SvgPreview
              svg={subtractedSvg ?? request.svg_content}
              highlightColor={null}
              enabledColors={enabledColors}
              colorMap={predictedByColor}
            />
          </PreviewBlock>
        </div>
      </div>
      <MergeColorsDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        layers={request.layers}
        shapeCountsByColor={shapeCountsByColor}
        onConfirm={handleMergeConfirm}
      />
      <SimplifyShapesDialog
        open={simplifyDialogOpen}
        onOpenChange={setSimplifyDialogOpen}
        svgContent={request.svg_content}
        widthMm={request.width_mm}
        onConfirm={handleSimplifyConfirm}
      />
    </PageContainer>
  );
}

function PreviewBlock({
  title,
  trailing,
  subtext,
  children,
}: {
  title: string;
  trailing?: React.ReactNode;
  subtext?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          {title}
        </span>
        {subtext && <span className="text-[11px]">{subtext}</span>}
        {trailing && <span className="ml-auto">{trailing}</span>}
      </div>
      <Card variant="inset" padded={false} className="h-[40vh] min-h-[240px] overflow-hidden">
        {children}
      </Card>
    </div>
  );
}

function LayerEditor({
  layer,
  layerIdx,
  projectMaterialId,
  onPatch,
  onBasePatch,
  onPaletteApply,
  appliedHex,
}: {
  layer: LayerSpec;
  layerIdx: number;
  projectMaterialId: string;
  onPatch: (p: Partial<LayerSpec>) => void;
  onBasePatch: (p: Partial<LayerSpec["base_params"]>) => void;
  onPaletteApply: (
    params: Partial<LayerSpec["base_params"]>,
    predictedHex: string,
  ) => void;
  /** Hex of whichever palette entry's params are currently applied to
   *  this layer, or undefined if none. Drives the active-chip highlight
   *  in the matcher so it tracks the layer's actual state — switching
   *  layers no longer falsely highlights the closest match. */
  appliedHex?: string;
}) {
  const hatchIssues = validateLayerSpec(layer, layerIdx);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-8 w-8 rounded-[6px] shrink-0 border border-[color:var(--color-border-strong)]"
          style={{ background: layer.color }}
        />
        <input
          value={layer.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="flex-1 min-w-0 bg-transparent border-0 border-b border-transparent hover:border-[color:var(--color-border)] focus:outline-none focus:border-[color:var(--color-primary)] text-[17px] font-semibold text-[color:var(--color-ink)] px-0 py-1"
        />
        <Badge variant="neutral" size="sm">
          <span className="font-mono">{layer.color}</span>
        </Badge>
      </div>

      {layer.color !== "none" && (
        <PaletteMatchSection
          layerColor={layer.color}
          materialId={projectMaterialId}
          onApply={onPaletteApply}
          appliedHex={appliedHex}
        />
      )}

      <Section title="Processing">
        <Field label="Processing type">
          <Select
            value={layer.processing_type}
            onChange={(e) => {
              const v = e.target.value as SvgProcessingType;
              const patch: Partial<LayerSpec> = { processing_type: v };
              if (v === "HATCHED_LINES" && layer.hatch_passes.length === 0) {
                patch.hatch_passes = [defaultHatchPass(0)];
              }
              onPatch(patch);
            }}
          >
            {PROCESSING_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {layer.processing_type !== "HATCHED_LINES" && (
          <NumberField
            label="Scan angle (°)"
            value={layer.scan_angle}
            onChange={(v) => onPatch({ scan_angle: v })}
          />
        )}
      </Section>

      {layer.processing_type !== "HATCHED_LINES" && (
        <Section title="Passes (multi-pass angle)">
          <Field label="Angle mode">
            <Select
              value={layer.angle_mode}
              onChange={(e) =>
                onPatch({ angle_mode: e.target.value as LayerSpec["angle_mode"] })
              }
            >
              <option value="fixed">Fixed — all passes at scan angle</option>
              <option value="crosshatch">Crosshatch — alternate ±90°</option>
              <option value="incremental">Incremental — XCS rotates per pass</option>
            </Select>
          </Field>
          <p className="text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
            Pass count comes from <strong>Base parameters → Passes</strong>. XCS
            handles the stacking natively; no rect duplication.
          </p>
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
        <p className="text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
          Params come from the palette match above — pick a swatch to apply
          its values to this layer. Manual edits below override.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Power %"
            value={layer.base_params.power}
            onChange={(v) => onBasePatch({ power: v })}
          />
          <NumberField
            label="Speed (mm/s)"
            value={layer.base_params.speed}
            integer
            onChange={(v) => onBasePatch({ speed: v })}
          />
          <NumberField
            label="Frequency (Hz)"
            value={layer.base_params.frequency}
            integer
            onChange={(v) => onBasePatch({ frequency: v })}
          />
          <NumberField
            label="Lines/cm"
            value={layer.base_params.density}
            integer
            onChange={(v) => onBasePatch({ density: v })}
          />
          <NumberField
            label="Passes"
            value={layer.base_params.passes}
            integer
            min={1}
            onChange={(v) => onBasePatch({ passes: v })}
          />
          <PulseWidthSelect
            value={layer.base_params.pulse_width}
            onChange={(v) => onBasePatch({ pulse_width: v })}
          />
          <div className="col-span-2">
            <Field label="Laser">
              <Select
                value={layer.base_params.laser}
                onChange={(e) =>
                  onBasePatch({ laser: e.target.value as "red" | "blue" })
                }
              >
                <option value="red">Red (MOPA)</option>
                <option value="blue">Blue (diode)</option>
              </Select>
            </Field>
          </div>
        </div>
      </Section>
    </div>
  );
}

function SvgPreview({
  svg,
  highlightColor,
  enabledColors,
  colorMap,
}: {
  svg: string;
  highlightColor: string | null;
  enabledColors: Set<string>;
  colorMap?: Record<string, string>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const svgEl = wrapper.querySelector("svg");
    if (!svgEl) return;

    const originalW = svgEl.getAttribute("width");
    const originalH = svgEl.getAttribute("height");
    if (!svgEl.getAttribute("viewBox") && originalW && originalH) {
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
      el.style.opacity = "";
      el.style.display = "";
      if (el.tagName === "svg" || el.tagName === "g" || el.tagName === "defs") return;

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
      if (color === "") return;

      if (!enabledColors.has(color)) {
        el.style.display = "none";
        return;
      }

      if (highlightColor && color !== highlightColor) {
        el.style.opacity = "0.15";
      }

      const desired = colorMap && colorMap[color] ? colorMap[color] : color;
      if (el.getAttribute("fill") && el.getAttribute("fill") !== "none") {
        el.setAttribute("fill", desired);
      }
      if (el.getAttribute("stroke") && el.getAttribute("stroke") !== "none") {
        el.setAttribute("stroke", desired);
      }
      const styleAttr = el.getAttribute("style");
      if (styleAttr && /(fill|stroke):/.test(styleAttr)) {
        const replaced = styleAttr
          .replace(/fill:\s*[^;]+/, (m) =>
            m.includes("none") ? m : `fill: ${desired}`,
          )
          .replace(/stroke:\s*[^;]+/, (m) =>
            m.includes("none") ? m : `stroke: ${desired}`,
          );
        el.setAttribute("style", replaced);
      }
    });
  }, [svg, highlightColor, enabledColors, colorMap]);

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full flex items-center justify-center p-3"
    >
      {svg ? (
        <div
          className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <EmptyState
          icon={<FileCode2 className="h-6 w-6" />}
          title="Upload an SVG"
          description="Drop a file on the left panel to preview it here."
        />
      )}
    </div>
  );
}

function deltaEToPercent(dE: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - dE * 2)));
}

function paletteParamsToBaseParams(
  params: { [k: string]: string | number },
): Partial<BaseParams> {
  const laser = params["laser"];
  const toInt = (v: string | number) =>
    typeof v === "number" ? Math.round(v) : Math.round(Number(v));
  return {
    power: typeof params["power"] === "number" ? params["power"] : Number(params["power"]),
    speed: toInt(params["speed"]),
    frequency: toInt(params["frequency"]),
    density: toInt(params["density"]),
    passes: toInt(params["passes"]),
    pulse_width: toInt(params["pulse_width"]),
    laser: laser === "blue" ? "blue" : "red",
  };
}

function PaletteMatchSection({
  layerColor,
  materialId,
  onApply,
  appliedHex,
}: {
  layerColor: string;
  materialId: string;
  onApply: (params: Partial<BaseParams>, predictedHex: string) => void;
  /** Hex of the palette entry whose params are currently applied to the
   *  parent layer. Drives the active-chip highlight, so switching layers
   *  shows the chip whose recipe is actually live (rather than the
   *  closest match, which was the source of the previous mis-highlight
   *  bug). Undefined → no chip highlighted. */
  appliedHex?: string;
}) {
  const [results, setResults] = useState<PaletteQueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Bumped each time a swatch is favorited so the favorites row refetches.
  const [favoritesNonce, setFavoritesNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResults([]);
    setError(undefined);
    if (!materialId || !/^#[0-9a-fA-F]{6}$/.test(layerColor)) return;
    setLoading(true);
    const matIdNum = materialId ? Number(materialId) : undefined;
    queryPalette(layerColor, { limit: 10, material_id: matIdNum, machine_id: getCurrentMachineId() })
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [layerColor, materialId]);

  // Highlight tracks what's actually applied to the parent layer.
  // Empty string ⇒ no chip highlighted (initial state, or applied entry
  // not in the current top-N matches — e.g., a manual entry beyond limit).
  const selectedId = useMemo(() => {
    if (!appliedHex) return "";
    const want = appliedHex.toLowerCase();
    const hit = results.find((r) => r.entry.hex.toLowerCase() === want);
    return hit ? String(hit.entry.id) : "";
  }, [appliedHex, results]);

  // Only ever called with next=true from the matcher: the layer page lets
  // users add a favorite but never remove one. Removal lives on the Palette
  // page so a stray click here can't disrupt a focused matching session.
  async function onFavoriteToggle(entry: PaletteEntry, next: boolean) {
    if (!next) return;
    setResults((prev) =>
      prev.map((r) =>
        r.entry.id === entry.id
          ? { ...r, entry: { ...r.entry, favorited: true } }
          : r,
      ),
    );
    try {
      await patchPaletteEntry(entry.id, { favorited: true });
      setFavoritesNonce((n) => n + 1);
    } catch {
      // rollback
      setResults((prev) =>
        prev.map((r) =>
          r.entry.id === entry.id
            ? { ...r, entry: { ...r.entry, favorited: false } }
            : r,
        ),
      );
    }
  }

  const selected = results.find((r) => String(r.entry.id) === selectedId) ?? results[0];

  if (!materialId) {
    return (
      <div className="rounded-[6px] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-tint)]/60 px-3 py-2 text-[12px] text-[color:var(--color-warning)]">
        Pick a project material in the left column to see palette matches.
      </div>
    );
  }

  return (
    <Card variant="elevated" padded={false} className="p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          Palette match
        </div>
        {loading && (
          <div className="text-[11px] text-[color:var(--color-ink-subtle)]">
            Searching…
          </div>
        )}
      </div>
      {error && (
        <p className="text-[12px] text-[color:var(--color-destructive)]">{error}</p>
      )}
      {!loading && !error && results.length === 0 && (
        <p className="text-[12px] text-[color:var(--color-ink-muted)]">
          No palette entries for this material yet. Burn a test and upload it
          on the Palette tab.
        </p>
      )}
      {selected && (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <SwatchBox color={layerColor} label="layer" />
            <div className="text-[color:var(--color-ink-subtle)] text-[16px]">→</div>
            <SwatchBox color={selected.entry.hex} label="palette" />
            <div className="ml-2 leading-tight">
              <div className="text-[14px] font-semibold text-[color:var(--color-ink)]">
                {deltaEToPercent(selected.delta_e)}% match
              </div>
              <div className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                ΔE {selected.delta_e.toFixed(2)}
              </div>
            </div>
          </div>
          {results.length > 1 && (
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
                  {results.length} matches
                </span>
                <span className="text-[10.5px] text-[color:var(--color-ink-subtle)]">
                  click a swatch to apply its params
                </span>
              </div>
              <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(82px,1fr))]">
                {results.map((r) => {
                  const isActive = String(r.entry.id) === selectedId;
                  const p = r.entry.params;
                  const laser = String(p.laser ?? "red");
                  return (
                    <button
                      key={r.entry.id}
                      type="button"
                      onClick={() => {
                        // Apply propagates a new appliedHex up to the
                        // parent → re-render → derived selectedId picks
                        // up the new chip. No local highlight state.
                        onApply(paletteParamsToBaseParams(r.entry.params), r.entry.hex);
                      }}
                      aria-pressed={isActive}
                      aria-label={`Apply palette match ${r.entry.hex}`}
                      title={`ΔE ${r.delta_e.toFixed(2)} · ${p.power}% · ${p.speed} mm/s · ${laser}`}
                      className={cn(
                        "group relative rounded-[6px] overflow-hidden border text-left transition-all",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50",
                        isActive
                          ? "border-[color:var(--color-primary)] shadow-[0_0_0_1px_var(--color-primary)_inset]"
                          : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]",
                      )}
                    >
                      <div
                        className="aspect-[4/3] w-full relative"
                        style={{ background: r.entry.hex }}
                      >
                        {r.entry.source === "manual" && (
                          <span className="absolute top-1 left-1 px-1 py-0.5 rounded-[3px] text-[8px] font-mono font-semibold tracking-[0.08em] uppercase bg-[color:var(--color-accent,#caa14b)] text-black/85">
                            MAN
                          </span>
                        )}
                        {r.entry.favorited ? (
                          <span
                            aria-label="Favorited"
                            title="Favorited"
                            className="absolute top-0.5 right-0.5 inline-flex items-center justify-center p-1"
                          >
                            <Star
                              className="h-3.5 w-3.5"
                              strokeWidth={2}
                              fill="var(--color-accent, #caa14b)"
                              color="var(--color-accent, #caa14b)"
                            />
                          </span>
                        ) : (
                          <StarToggle
                            favorited={false}
                            onChange={(next) => { if (next) onFavoriteToggle(r.entry, true); }}
                            className="absolute top-0.5 right-0.5"
                          />
                        )}
                      </div>
                      <div
                        className={cn(
                          "px-1.5 py-1 border-t leading-tight",
                          isActive
                            ? "bg-[color:var(--color-primary-tint)] border-[color:var(--color-primary)]/30"
                            : "bg-[color:var(--color-surface)] border-[color:var(--color-border)]",
                        )}
                      >
                        <div className="font-mono text-[10px] text-[color:var(--color-ink)] truncate">
                          {r.entry.hex}
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className="font-mono text-[9.5px] text-[color:var(--color-ink-subtle)]">
                            ΔE {r.delta_e.toFixed(1)}
                          </span>
                          <span
                            aria-hidden="true"
                            title={`${laser} laser`}
                            className={cn(
                              "h-1.5 w-1.5 rounded-full shrink-0",
                              laser === "blue"
                                ? "bg-[color:var(--color-secondary)]"
                                : "bg-[color:var(--color-primary)]",
                            )}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <PaletteFavoritesRow
            layerColor={layerColor}
            materialId={materialId}
            appliedHex={appliedHex}
            onApply={onApply}
            refreshKey={favoritesNonce}
          />
          <div className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
            {Object.entries(paletteParamsToBaseParams(selected.entry.params))
              .map(([k, v]) => `${k}=${v}`)
              .join("  ·  ")}
          </div>
        </div>
      )}
    </Card>
  );
}

function PaletteFavoritesRow({
  layerColor,
  materialId,
  appliedHex,
  onApply,
  refreshKey,
}: {
  layerColor: string;
  materialId: string;
  /** Hex of the recipe currently applied to the parent layer. The active
   *  chip is derived against this row's own favourites list — so a
   *  favourited chip outside the matcher's top-N still highlights here. */
  appliedHex?: string;
  onApply: (params: Partial<BaseParams>, predictedHex: string) => void;
  refreshKey: number;
}) {
  const [favorites, setFavorites] = useState<PaletteEntry[]>([]);
  const [page, setPage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const CHIP_WIDTH = 90; // matches the suggested-grid chip footprint + gap

  useEffect(() => {
    if (!materialId) {
      setFavorites([]);
      return;
    }
    let cancelled = false;
    listPaletteEntries({
      material_id: Number(materialId), favorites_only: true, machine_id: getCurrentMachineId(),
    })
      .then((es) => { if (!cancelled) setFavorites(es); })
      .catch(() => { if (!cancelled) setFavorites([]); });
    return () => { cancelled = true; };
  }, [materialId, refreshKey]);

  // Re-attach observer when favorites first arrive — the row returns null
  // while empty, so the ref doesn't exist on initial mount.
  const hasFavorites = favorites.length > 0;
  useEffect(() => {
    if (!hasFavorites) return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [hasFavorites]);

  const sorted = useMemo(() => {
    if (!/^#[0-9a-fA-F]{6}$/.test(layerColor)) return favorites;
    const target = hexToLab(layerColor);
    return [...favorites].sort((a, b) => {
      const la = a.lab.length >= 3 ? ([a.lab[0], a.lab[1], a.lab[2]] as Lab) : hexToLab(a.hex);
      const lb = b.lab.length >= 3 ? ([b.lab[0], b.lab[1], b.lab[2]] as Lab) : hexToLab(b.hex);
      return deltaE2000(target, la) - deltaE2000(target, lb);
    });
  }, [favorites, layerColor]);

  const pager = computePager({
    totalCount: sorted.length,
    containerWidth: Math.max(0, containerWidth - 80), // reserve room for prev/next + label
    chipWidth: CHIP_WIDTH,
    page,
  });

  if (favorites.length === 0) return null;

  const slice = sorted.slice(pager.start, pager.end);

  return (
    <div ref={containerRef} className="mt-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          ★ Favorites
        </span>
        {pager.totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-[color:var(--color-ink-subtle)]">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, pager.page - 1))}
              disabled={pager.page === 0}
              className="px-1.5 py-0.5 rounded border border-[color:var(--color-border)] disabled:opacity-30"
              aria-label="Previous favorites"
            >‹</button>
            <span>{pager.page + 1} / {pager.totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pager.totalPages - 1, pager.page + 1))}
              disabled={pager.page >= pager.totalPages - 1}
              className="px-1.5 py-0.5 rounded border border-[color:var(--color-border)] disabled:opacity-30"
              aria-label="Next favorites"
            >›</button>
          </div>
        )}
      </div>
      <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(82px,1fr))]">
        {slice.map((entry) => {
          const target = /^#[0-9a-fA-F]{6}$/.test(layerColor) ? hexToLab(layerColor) : null;
          const lab = entry.lab.length >= 3
            ? ([entry.lab[0], entry.lab[1], entry.lab[2]] as Lab)
            : hexToLab(entry.hex);
          const dE = target ? deltaE2000(target, lab) : 0;
          const laser = String(entry.params["laser"] ?? "red");
          const isActive = !!appliedHex && entry.hex.toLowerCase() === appliedHex.toLowerCase();
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onApply(paletteParamsToBaseParams(entry.params), entry.hex)}
              aria-pressed={isActive}
              title={`ΔE ${dE.toFixed(2)} · ${entry.params.power}% · ${entry.params.speed} mm/s · ${laser}`}
              className={cn(
                "group relative rounded-[6px] overflow-hidden border text-left transition-all",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50",
                isActive
                  ? "border-[color:var(--color-primary)] shadow-[0_0_0_1px_var(--color-primary)_inset]"
                  : "border-[color:var(--color-border)] hover:border-[color:var(--color-border-strong)]",
              )}
            >
              <div className="aspect-[4/3] w-full relative" style={{ background: entry.hex }}>
                {entry.source === "manual" && (
                  <span className="absolute top-1 left-1 px-1 py-0.5 rounded-[3px] text-[8px] font-mono font-semibold tracking-[0.08em] uppercase bg-[color:var(--color-accent,#caa14b)] text-black/85">
                    MAN
                  </span>
                )}
                {/* No star control here — every chip in this row is by definition
                    favorited; unfavoriting lives on the Palette page. */}
              </div>
              <div className={cn(
                "px-1.5 py-1 border-t leading-tight",
                isActive
                  ? "bg-[color:var(--color-primary-tint)] border-[color:var(--color-primary)]/30"
                  : "bg-[color:var(--color-surface)] border-[color:var(--color-border)]",
              )}>
                <div className="font-mono text-[10px] text-[color:var(--color-ink)] truncate">{entry.hex}</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="font-mono text-[9.5px] text-[color:var(--color-ink-subtle)]">
                    ΔE {dE.toFixed(1)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      laser === "blue"
                        ? "bg-[color:var(--color-secondary)]"
                        : "bg-[color:var(--color-primary)]",
                    )}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SwatchBox({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="h-10 w-10 rounded-[6px] border border-[color:var(--color-border-strong)]"
        style={{ background: color }}
      />
      <div className="text-[10px] text-[color:var(--color-ink-subtle)]">{label}</div>
      <div className="font-mono text-[10px] text-[color:var(--color-ink)]">{color}</div>
    </div>
  );
}
