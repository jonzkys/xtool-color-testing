import { useEffect, useMemo, useRef, useState } from "react";
import {
  PageContainer,
  MetalBar,
  Button,
  EmptyState,
  Card,
} from "../ui";
import type { ForgeFormat } from "../lib/forge/forge.worker";
import { FormatToggle } from "../components/FormatToggle";
import { DEFAULT_OUTPUT_FORMAT } from "../generate";
import type { Contour, ForgeConfig } from "../lib/forge/types";
import { SPIRAL_CUT } from "../lib/forge/presets";
import { STAGE_GROUPS } from "../lib/forge/config";
import { splitSubpaths } from "../lib/forge/contour";
import { useForgeEngine } from "../hooks/useForgeEngine";
import { ForgeCanvas, CLASS_COLOR } from "../components/forge/ForgeCanvas";
import { ForgeSourcePanel } from "../components/forge/ForgeSourcePanel";
import { ForgeDebugPanel } from "../components/forge/ForgeDebugPanel";
import { ForgeEstimateStrip } from "../components/forge/ForgeEstimateStrip";
import { ForgeStageParams } from "../components/forge/ForgeStageParams";
import { SpiralControls } from "../components/forge/SpiralControls";

// Separate key from Forge's `forge.config.v7` so the two pages never clobber
// each other's setup. The stored value is a spiral-locked ForgeConfig.
const CONFIG_LS_KEY = "spiral.config.v1";

/** Load the spiral config: SPIRAL_CUT preset as the floor, with the fields this
 *  page actually mutates (spiral.*, beam width, mm/unit) restored from a prior
 *  save. The spiral-only invariants (other stages off, spiral on) always come
 *  from the preset, so an old save can never resurrect a non-spiral stage. */
function loadConfig(): ForgeConfig {
  const base = structuredClone(SPIRAL_CUT);
  try {
    const raw = localStorage.getItem(CONFIG_LS_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<ForgeConfig>;
    return {
      ...base,
      beamWidthMm: p.beamWidthMm ?? base.beamWidthMm,
      mmPerUnitOverride: p.mmPerUnitOverride ?? base.mmPerUnitOverride,
      spiral: { ...base.spiral, ...(p.spiral ?? {}), enabled: true },
      stageParams: p.stageParams ?? base.stageParams,
      activePreset: "spiral",
    };
  } catch {
    return base;
  }
}

export function SpiralPage() {
  const [config, setConfig] = useState<ForgeConfig>(loadConfig);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 480 });
  const [spiralVisible, setSpiralVisible] = useState(true);
  const [exportFormat, setExportFormat] = useState<ForgeFormat>(DEFAULT_OUTPUT_FORMAT);

  const { state, result, selectedIncise, setSelectedIncise, handleFile, exportAs } =
    useForgeEngine(config);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // persist config to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_LS_KEY, JSON.stringify(config));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [config]);

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
    if (mmPerUnit === 1) return subpaths;
    return subpaths.map((c) => ({
      points: c.points.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit })),
      closed: c.closed,
    }));
  }, [state, selectedIncise, result?.stats.mmPerUnit]);

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

  // only the spiral class ever renders here; the legend toggles it
  const visible = useMemo(
    () => ({ seed: false, perforate: false, deepen: false, clean: false, spiral: spiralVisible }),
    [spiralVisible],
  );

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
          {state.kind === "ready" && (
            <span className="font-mono text-xs text-[var(--color-ink-muted)]">{state.fileName}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <label className="px-3 py-1.5 text-xs font-mono uppercase rounded bg-[var(--color-primary)] text-white cursor-pointer hover:bg-[var(--color-primary-hover)] transition-colors">
              Upload .xcs / .xs
              <input
                ref={fileInputRef}
                type="file"
                accept=".xcs,.xs,application/json,application/zip"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <FormatToggle value={exportFormat} onChange={setExportFormat} />
            <Button disabled={!canExport} onClick={() => exportAs(exportFormat)}>
              {exportFormat === "xs" ? "Export modified .xs" : "Export modified .xcs"}
            </Button>
          </div>
        </div>
        <div className="shrink-0">
          <MetalBar variant="soft" />
        </div>

        {state.kind === "idle" && (
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <EmptyState
              title="Upload an xTool .xcs or .xs"
              description="Spiral Cut converts the selected incise (INTAGLIO) contour into one continuous concentric spiral that severs the silhouette in a single flat-mode vector cut. Emboss / other incise layers are dropped on export — process those as a separate job."
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
              <ForgeEstimateStrip estimate={result?.stats.estimate ?? null} />
            </div>

            <div className="flex-1 min-h-0 pt-3 grid grid-cols-[248px_minmax(0,1fr)_332px] gap-3 items-stretch">
              {/* LEFT */}
              <ForgeSourcePanel
                validation={validation}
                targetIds={state.targetIds}
                selectedIncise={selectedIncise}
                onSelectIncise={setSelectedIncise}
                preservedIds={state.preservedIds}
                objects={state.objects}
              />

              {/* CENTER */}
              <div className="min-w-0 min-h-0 flex flex-col gap-2">
                <Card variant="inset" padded={false} className="flex-1 min-h-0 p-2 flex flex-col">
                  <div ref={canvasWrapRef} className="flex-1 min-h-0 min-w-0 overflow-hidden">
                    <ForgeCanvas
                      source={sourceContour}
                      paths={result?.paths ?? []}
                      visible={visible}
                      width={canvasSize.w}
                      height={canvasSize.h}
                    />
                  </div>
                  <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2">
                    <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={spiralVisible}
                        onChange={() => setSpiralVisible((v) => !v)}
                      />
                      <span
                        className="inline-block h-3 w-3 rounded-[2px] border border-black/10"
                        style={{ backgroundColor: CLASS_COLOR.spiral }}
                        aria-hidden
                      />
                      spiral
                    </label>
                  </div>
                </Card>

                {/* docked laser & focus tray — single spiral stage, no tabs */}
                <div className="shrink-0 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
                    <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                      Laser &amp; focus
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--color-ink-subtle)]">
                      applied on export
                    </span>
                  </div>
                  <div className="max-h-[480px] overflow-y-auto">
                    <ForgeStageParams
                      frameless
                      lockToGroup={STAGE_GROUPS.spiral}
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

              {/* RIGHT */}
              <div className="min-h-0 overflow-y-auto pr-1 flex flex-col gap-3">
                <SpiralControls config={config} onChange={setConfig} />
                <ForgeDebugPanel stats={result?.stats ?? null} optimizeScanAngle={config.optimizeScanAngle} />
              </div>
            </div>
          </>
        )}
      </PageContainer>
    </div>
  );
}
