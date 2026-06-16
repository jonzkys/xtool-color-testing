import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PageContainer,
  MetalBar,
  Button,
  EmptyState,
  Card,
  CardHeader,
  CardTitle,
  Field,
  NumberField,
} from "../ui";
import type { ForgeFormat } from "../lib/forge/forge.worker";
import { FormatToggle } from "../components/FormatToggle";
import { DEFAULT_OUTPUT_FORMAT, svgStackToBytes } from "../generate";
import { defaultBaseParams } from "../defaults";
import { listMaterials } from "../api/library";
import type { SvgStackRequest } from "../types";
import type { Contour, ForgeConfig, XcsObject } from "../lib/forge/types";
import { loadMaterialState, serializeMaterialState, MATERIAL_LS_KEY, OLD_CONFIG_LS_KEY, LEGACY_MATERIAL_LS_KEYS, type MaterialState } from "../lib/forge/materialState";
import { MaterialSelector } from "../components/forge/MaterialSelector";
import type { MaterialThicknessMm } from "../lib/forge/types";
import { STAGE_GROUPS } from "../lib/forge/config";
import { splitSubpaths } from "../lib/forge/contour";
import { simplifyLoop } from "../lib/forge/offset";
import { useForgeEngine } from "../hooks/useForgeEngine";
import { SpiralCanvas } from "../components/forge/SpiralCanvas";
import { ForgeSourcePanel } from "../components/forge/ForgeSourcePanel";
import { SpiralGeometryPanel } from "../components/forge/SpiralGeometryPanel";
import { ForgeEstimateStrip } from "../components/forge/ForgeEstimateStrip";
import { ForgeStageParams } from "../components/forge/ForgeStageParams";
import { SpiralControls } from "../components/forge/SpiralControls";
import { buildSpiralSvg } from "../lib/forge/svgExport";

/** Output formats the spiral page offers — the worker's .xs/.xcs plus an
 *  SVG of the cut paths (built page-side). */
type SpiralExportFormat = ForgeFormat | "svg";

/** Best-effort physical width (mm) from an SVG's width attribute. Unitless / px
 *  widths are NOT treated as mm (that would blow past the 500mm cap); they fall
 *  back to a sane default the user can re-scale later. Clamped 1–500. */
function svgWidthMm(svg: string): number {
  const m = svg.match(/<svg[^>]*\bwidth\s*=\s*["']([\d.]+)\s*(mm|cm|in)?["']/i);
  let mm = 100;
  if (m) {
    const v = parseFloat(m[1]);
    const unit = (m[2] || "").toLowerCase();
    if (unit === "mm") mm = v;
    else if (unit === "cm") mm = v * 10;
    else if (unit === "in") mm = v * 25.4;
    // unitless/px → keep the 100mm default
  }
  // Round to 1 decimal so the width field shows a clean value (in→mm etc. can
  // produce long decimals).
  return Math.min(500, Math.max(1, Math.round((mm || 100) * 10) / 10));
}

/** Pick the largest target (by source-contour bbox area) — the usual silhouette
 *  when an imported SVG yields several VECTOR_CUTTING shapes. */
function largestTargetId(objects: XcsObject[], targetIds: string[]): string | null {
  let best: string | null = null;
  let bestArea = -1;
  for (const id of targetIds) {
    const o = objects.find((x) => x.id === id);
    if (!o?.dPath) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of splitSubpaths(o.dPath)) {
      for (const p of c.points) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
    }
    if (!Number.isFinite(minX)) continue;
    const area = (maxX - minX) * (maxY - minY);
    if (area > bestArea) { bestArea = area; best = id; }
  }
  return best;
}


export function SpiralPage() {
  const [material, setMaterial] = useState<MaterialState>(() => loadMaterialState((k) => localStorage.getItem(k)));
  const config = material.configs[String(material.activeThicknessMm)];
  const setConfig = useCallback((next: ForgeConfig) => {
    setMaterial((m) => ({ ...m, configs: { ...m.configs, [String(m.activeThicknessMm)]: next } }));
  }, []);
  const setActiveThickness = useCallback((mm: MaterialThicknessMm) => {
    setMaterial((m) => ({ ...m, activeThicknessMm: mm }));
  }, []);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 480 });
  const [exportFormat, setExportFormat] = useState<SpiralExportFormat>(DEFAULT_OUTPUT_FORMAT);
  // SVG import: a material id (seeds the svg-stack request; spiral export
  // overrides params), a "converting" flag while svg-stack runs, and any error.
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // The imported SVG (text + name) and its target physical width (mm). Held so
  // changing the width can re-convert at the new size — width_mm is baked at
  // svg-stack time, so a re-import is the only way to rescale.
  const [svgImport, setSvgImport] = useState<{ text: string; name: string } | null>(null);
  const [svgWidth, setSvgWidth] = useState(100);
  // Per-loaded-file target width (mm) for .xs/.xcs; null = native size. Resets on
  // each new file load. Merged into the config fed to the worker (page-level, so
  // it's shared across brass thicknesses).
  const [sourceWidthMm, setSourceWidthMm] = useState<number | null>(null);

  const liveConfig = useMemo(() => ({ ...config, sourceWidthMm }), [config, sourceWidthMm]);
  const { state, result, selectedIncise, setSelectedIncise, handleFile, loadBuffer, exportAs } =
    useForgeEngine(liveConfig);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // Reset the per-file target width whenever a different file loads (so the Width
  // field shows the new file's native size, not the previous override).
  const loadedFile = state.kind === "ready" ? state.fileName : null;
  useEffect(() => { setSourceWidthMm(null); }, [loadedFile]);

  // Active material for the svg-stack import request (Loom's pattern: first
  // material). Fetched once; SVG import is blocked with a message if none.
  useEffect(() => {
    let live = true;
    listMaterials()
      .then((mats) => { if (live && mats[0]) setMaterialId(String(mats[0].id)); })
      .catch(() => { /* SVG import will report "no material" if needed */ });
    return () => { live = false; };
  }, []);

  // Auto-pick the largest target when an import yields several (e.g. an SVG with
  // multiple shapes). The engine already auto-selects when there's exactly one.
  useEffect(() => {
    if (state.kind === "ready" && !selectedIncise && state.targetIds.length > 1) {
      const id = largestTargetId(state.objects, state.targetIds);
      if (id) setSelectedIncise(id);
    }
  }, [state, selectedIncise, setSelectedIncise]);

  /** Route an upload: SVG is held (text + derived width) so the size control can
   *  re-convert it; everything else goes through the worker's file reader. The
   *  actual svg-stack conversion runs in the debounced effect below. */
  function handleUpload(f: File) {
    setImportError(null);
    const isSvg = f.name.toLowerCase().endsWith(".svg") || f.type === "image/svg+xml";
    if (!isSvg) {
      setSvgImport(null);
      handleFile(f);
      return;
    }
    if (!materialId) {
      setImportError("No material available — add one in the Library before importing an SVG.");
      return;
    }
    f.text()
      .then((text) => {
        setSvgWidth(svgWidthMm(text));
        setSvgImport({ text, name: f.name });
      })
      .catch((err: unknown) => setImportError(err instanceof Error ? err.message : String(err)));
  }

  // Convert the held SVG via /api/svg-stack whenever it or its target width
  // changes (debounced, so dragging the width field doesn't spam the endpoint).
  useEffect(() => {
    if (!svgImport || !materialId) return;
    const t = setTimeout(() => {
      setConverting(true);
      const req: SvgStackRequest = {
        name: svgImport.name.replace(/\.svg$/i, "") || "spiral",
        svg_content: svgImport.text,
        width_mm: Math.min(500, Math.max(1, svgWidth)),
        height_mm: null,
        start_x: 10,
        start_y: 10,
        base_params: defaultBaseParams(),
        processing_type: "VECTOR_CUTTING",
        scan_angle: 90,
        stack_passes: 1,
        stack_step_deg: 90,
        material_id: materialId,
        subtract_overlaps: false,
        format: "xcs",
      };
      svgStackToBytes(req)
        .then((buf) => loadBuffer(buf, svgImport.name))
        .catch((err: unknown) => setImportError(err instanceof Error ? err.message : String(err)))
        .finally(() => setConverting(false));
    }, 350);
    return () => clearTimeout(t);
  }, [svgImport, svgWidth, materialId, loadBuffer]);

  /** Export: SVG is built page-side from the generated paths; .xs/.xcs go
   *  through the worker's export (round-trips the parsed document). */
  function onExport() {
    if (exportFormat !== "svg") {
      exportAs(exportFormat);
      return;
    }
    const svg = buildSpiralSvg(result?.paths ?? []);
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spiral-cut.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Persist the per-thickness material map; drop the pre-material single-config
  // key and superseded material keys (their baseline shapes predate the current
  // {speed, layers} defaults).
  useEffect(() => {
    try {
      localStorage.setItem(MATERIAL_LS_KEY, serializeMaterialState(material));
      localStorage.removeItem(OLD_CONFIG_LS_KEY);
      for (const k of LEGACY_MATERIAL_LS_KEYS) localStorage.removeItem(k);
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [material]);

  // canvas fills its grid cell (both dimensions measured)
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({
        w: Math.max(320, el.clientWidth),
        h: Math.max(160, el.clientHeight),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.kind]);

  // source contours scaled to mm space so they align with the spiral paths
  const sourceContour: Contour[] | null = useMemo(() => {
    if (state.kind !== "ready" || !selectedIncise) return null;
    const obj = state.objects.find((o) => o.id === selectedIncise);
    if (!obj?.dPath) return null;
    const subpaths = splitSubpaths(obj.dPath);
    if (subpaths.length === 0) return null;
    const mmPerUnit = result?.stats.mmPerUnit ?? 1;
    let scaled = mmPerUnit === 1
      ? subpaths
      : subpaths.map((c) => ({
          points: c.points.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit })),
          closed: c.closed,
        }));
    // Mirror the pipeline's per-file resize so the schematic reflects the Width control.
    const nativeW = result?.stats.nativeWidthMm ?? 0;
    if (sourceWidthMm != null && sourceWidthMm > 0 && nativeW > 0) {
      const s = sourceWidthMm / nativeW;
      if (Math.abs(s - 1) > 1e-6) {
        scaled = scaled.map((c) => ({ ...c, points: c.points.map((p) => ({ x: p.x * s, y: p.y * s })) }));
      }
    }
    // Mirror the pipeline's source simplification so the schematic reflects the
    // Simplify control (the spiral arms follow the simplified outline on export).
    const eps = config.spiral.simplifyEpsMm;
    return config.spiral.enabled && eps > 0
      ? scaled.map((c) => ({ ...c, points: simplifyLoop(c.points, eps) }))
      : scaled;
  }, [state, selectedIncise, result?.stats.mmPerUnit, result?.stats.nativeWidthMm, sourceWidthMm, config.spiral.enabled, config.spiral.simplifyEpsMm]);

  // Doubled-wall incise target (INTAGLIO) → the schematic rebuilds the solid
  // object (buildPartRegion), matching the generator; a VECTOR/SVG silhouette
  // uses the even-odd fill. Mirrors the dispatch in pipeline.ts.
  const intaglioTarget = useMemo(() => {
    if (state.kind !== "ready" || !selectedIncise) return false;
    return state.objects.find((o) => o.id === selectedIncise)?.processingType !== "VECTOR_CUTTING";
  }, [state, selectedIncise]);

  // Does the pipeline result include internal-arm paths (CUT_09_SPIRAL_DETAIL)?
  const hasInternal = useMemo(
    () => (result?.paths ?? []).some((p) => p.groupName === STAGE_GROUPS.spiralDetail),
    [result],
  );

  // ---- validation ----
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (state.kind === "ready") {
      if (state.targetIds.length === 0)
        errors.push("No incise contour with usable geometry found.");
      if (state.targetIds.length > 1 && !selectedIncise)
        errors.push("Multiple incise contours — select a target.");
      const obj = selectedIncise ? state.objects.find((o) => o.id === selectedIncise) : null;
      if (selectedIncise && !obj?.dPath)
        errors.push("Selected target is not a usable vector/path contour.");
    }
    const warnings = result?.stats.warnings ?? [];
    return { errors, warnings };
  }, [state, selectedIncise, result]);

  const canExport =
    state.kind === "ready" && !!selectedIncise && validation.errors.length === 0 && !!result;

  return (
    <div className="relative flex flex-col" style={{ height: "calc(100dvh - 56px)" }}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--color-ink) 0 1px, transparent 1px 24px)",
        }}
      />
      <PageContainer
        maxWidth="wide"
        className="relative pt-3 pb-3 flex-1 min-h-0 flex flex-col overflow-hidden"
      >
        {/* header row */}
        <div className="shrink-0 flex items-center gap-3 pb-2">
          <h1 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-subtle)]">
            Spiral Cut
          </h1>
          {state.kind === "ready" && !converting && (
            <span className="font-mono text-xs text-[var(--color-ink-muted)]">{state.fileName}</span>
          )}
          {converting && (
            <span className="font-mono text-xs text-[var(--color-ink-muted)]">Converting SVG…</span>
          )}
          {importError && (
            <span className="font-mono text-xs text-[color:var(--color-destructive)] truncate">{importError}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <label className="px-3 py-1.5 text-xs font-mono uppercase rounded bg-[var(--color-primary)] text-white cursor-pointer hover:bg-[var(--color-primary-hover)] transition-colors">
              Upload .xcs / .xs / .svg
              <input
                ref={fileInputRef}
                type="file"
                accept=".xcs,.xs,.svg,application/json,application/zip,image/svg+xml"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f);
                  e.target.value = "";
                }}
              />
            </label>
            <FormatToggle<SpiralExportFormat>
              value={exportFormat}
              onChange={setExportFormat}
              formats={["xs", "xcs", "svg"]}
            />
            <Button disabled={!canExport} onClick={onExport}>
              {exportFormat === "svg" ? "Export cut .svg" : `Export modified .${exportFormat}`}
            </Button>
          </div>
        </div>
        <div className="shrink-0">
          <MetalBar variant="soft" />
        </div>

        {state.kind === "idle" && (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <EmptyState
              title="Upload an xTool .xcs / .xs — or an .svg"
              description="Spiral Cut converts the selected contour into one continuous concentric spiral that severs the silhouette in a single flat-mode vector cut. Upload an .xcs/.xs (pick its incise target) or an .svg (its largest shape is auto-selected). Export the cut as .xs/.xcs to run, or as .svg."
            />
          </div>
        )}
        {state.kind === "loading" && (
          <div className="flex-1 min-h-0 flex items-center justify-center p-6 font-mono text-sm text-[var(--color-ink-muted)]">
            Parsing {state.fileName}…
          </div>
        )}
        {state.kind === "error" && (
          <div className="flex-1 min-h-0 flex items-center justify-center p-6 font-mono text-sm text-[color:var(--color-destructive)]">
            Error: {state.message}
          </div>
        )}

        {state.kind === "ready" && (
          <>
            <div className="shrink-0 pt-3">
              <ForgeEstimateStrip estimate={result?.stats.estimate ?? null} variant="spiral" />
            </div>

            {/* grid-rows-[minmax(0,1fr)] bounds the single row to the container
                height; without it the row is auto-sized to the tallest column's
                content, so the right control rail overflows the height-capped
                parent (overflow-hidden) and its own overflow-y-auto never scrolls. */}
            <div className="flex-1 min-h-0 pt-3 grid grid-cols-[248px_minmax(0,1fr)_332px] grid-rows-[minmax(0,1fr)] gap-3 items-stretch">
              {/* LEFT: source + path geometry (its controls + live readout together) */}
              <div className="min-h-0 overflow-y-auto pr-1 flex flex-col gap-3 [&>*]:shrink-0">
                <ForgeSourcePanel
                  validation={validation}
                  targetIds={state.targetIds}
                  selectedIncise={selectedIncise}
                  onSelectIncise={setSelectedIncise}
                  preservedIds={state.preservedIds}
                  objects={state.objects}
                />
                <SpiralGeometryPanel stats={result?.stats ?? null} config={config} onChange={setConfig} />
              </div>

              {/* CENTER: schematic spiral preview — the hero, full height */}
              <Card variant="inset" padded={false} className="min-w-0 min-h-0 p-2">
                <div ref={canvasWrapRef} className="h-full w-full min-h-0 min-w-0 overflow-hidden">
                  <SpiralCanvas
                    source={sourceContour}
                    channelWidthMm={config.spiral.channelWidthMm}
                    pitchMm={config.spiral.pitchMm}
                    side={config.spiral.side}
                    intaglio={intaglioTarget}
                    splitNecks={config.spiral.splitNecks}
                    neckThresholdPct={config.spiral.neckThresholdPct}
                    neckOverlapMm={config.spiral.neckOverlapMm}
                    width={canvasSize.w}
                    height={canvasSize.h}
                  />
                </div>
              </Card>

              {/* RIGHT: cut geometry + laser/focus controls */}
              <div className="min-h-0 overflow-y-auto pr-1 flex flex-col gap-3 [&>*]:shrink-0">
                {svgImport && (
                  <Card>
                    <CardHeader><CardTitle>Imported SVG</CardTitle></CardHeader>
                    <div className="grid grid-cols-2 gap-2 p-2 text-xs">
                      <Field label="Width (mm)">
                        <NumberField
                          value={svgWidth}
                          step={1}
                          min={1}
                          max={500}
                          onChange={(v) => setSvgWidth(Math.min(500, Math.max(1, v)))}
                        />
                      </Field>
                    </div>
                  </Card>
                )}
                {!svgImport && result && (
                  <Card>
                    <CardHeader><CardTitle>Source size</CardTitle></CardHeader>
                    <div className="grid grid-cols-2 gap-2 p-2 text-xs">
                      <Field label="Width (mm)" help="Resize the imported design to this width — height follows. Clear to use the file's native size.">
                        <NumberField
                          value={sourceWidthMm ?? +result.stats.nativeWidthMm.toFixed(1)}
                          step={1}
                          min={1}
                          max={1000}
                          onChange={(v) => setSourceWidthMm(v > 0 ? v : null)}
                        />
                      </Field>
                    </div>
                  </Card>
                )}
                <MaterialSelector value={material.activeThicknessMm} onChange={setActiveThickness} />
                <SpiralControls config={config} onChange={setConfig} thicknessMm={material.activeThicknessMm} />
                {/* Laser & focus — single spiral stage, cut-mode (no density / no Z-descent) */}
                <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
                    <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                      Laser &amp; focus
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--color-ink-subtle)]">
                      applied on export
                    </span>
                  </div>
                  <ForgeStageParams
                    frameless
                    cutMode
                    cutGroups={hasInternal
                      ? [{ group: STAGE_GROUPS.spiral, label: "Main" }, { group: STAGE_GROUPS.spiralDetail, label: "Detail" }]
                      : [{ group: STAGE_GROUPS.spiral, label: "Main" }]}
                    config={config}
                    onChange={setConfig}
                    sourceParams={
                      selectedIncise
                        ? state.objects.find((o) => o.id === selectedIncise)?.params
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </PageContainer>
    </div>
  );
}
