import { useEffect, useMemo, useRef, useState } from "react";
import {
  PageContainer,
  MetalBar,
  Button,
  EmptyState,
  Card,
  CardHeader,
  CardTitle,
  Badge,
  notify,
} from "../ui";
import ForgeWorker from "../lib/forge/forge.worker?worker";
import type { ForgeFormat, ForgeRequest, ForgeResponse } from "../lib/forge/forge.worker";
import { FormatToggle } from "../components/FormatToggle";
import { DEFAULT_OUTPUT_FORMAT } from "../generate";
import type {
  Contour,
  ForgeConfig,
  GeneratedClass,
  PipelineResult,
  XcsObject,
} from "../lib/forge/types";
import { DEFAULT_CONFIG } from "../lib/forge/defaults";
import { splitSubpaths } from "../lib/forge/contour";
import { ForgeCanvas, CLASS_COLOR } from "../components/forge/ForgeCanvas";
import { ForgeControls } from "../components/forge/ForgeControls";
import { ForgeDebugPanel } from "../components/forge/ForgeDebugPanel";
import { ForgeEstimateStrip } from "../components/forge/ForgeEstimateStrip";
import { ForgeStageParams } from "../components/forge/ForgeStageParams";

// Bumped v1 → v2 when the default config shape/values changed (beam width
// 0.05→0.03, deepen groups dropped `fromLayer`, renamed default groups), then
// v2 → v3 for the new `optimizeScanAngle` field, v3 → v4 for the new
// `manualScanAngleDeg` field, v4 → v5 for the Lean default + new fields
// (layerCount on perforate/clean, timeBudgetX, activePreset); also clears any
// stale stageParams.sliceNumber that would otherwise win on export. A new key
// discards stale saved configs so users pick up the corrected defaults.
// v5 → v6: perforate relief fields (shape/nearGap/gapThresholdMm/slotLengthMm)
// v6 → v7: spiral sub-config (SpiralConfig)
const CONFIG_LS_KEY = "forge.config.v7"; // v6→v7: spiral sub-config

/** Load the saved config from localStorage, merged onto defaults so new fields
 *  (and the deepen group list) survive older saves. */
function loadConfig(): ForgeConfig {
  try {
    const raw = localStorage.getItem(CONFIG_LS_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const p = JSON.parse(raw) as Partial<ForgeConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...p,
      seed: { ...DEFAULT_CONFIG.seed, ...(p.seed ?? {}) },
      perforate: { ...DEFAULT_CONFIG.perforate, ...(p.perforate ?? {}) },
      deepen: {
        ...DEFAULT_CONFIG.deepen,
        ...(p.deepen ?? {}),
        groups: p.deepen?.groups ?? DEFAULT_CONFIG.deepen.groups,
      },
      clean: { ...DEFAULT_CONFIG.clean, ...(p.clean ?? {}) },
      spiral: { ...DEFAULT_CONFIG.spiral, ...(p.spiral ?? {}) },
      stageParams: p.stageParams ?? {},
      timeBudgetX: p.timeBudgetX ?? DEFAULT_CONFIG.timeBudgetX,
      activePreset: p.activePreset ?? DEFAULT_CONFIG.activePreset,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

type State =
  | { kind: "idle" }
  | { kind: "loading"; fileName: string }
  | {
      kind: "ready";
      fileName: string;
      objects: XcsObject[];
      targetIds: string[];
      preservedIds: string[];
      format: ForgeFormat;
    }
  | { kind: "error"; message: string };

const ALL_VISIBLE: Record<GeneratedClass, boolean> = {
  seed: true,
  perforate: true,
  deepen: true,
  clean: true,
  spiral: true,
};

const CLASSES: GeneratedClass[] = ["seed", "perforate", "deepen", "clean", "spiral"];

export function ForgePage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [config, setConfig] = useState<ForgeConfig>(loadConfig);
  const [selectedIncise, setSelectedIncise] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [visible, setVisible] = useState<Record<GeneratedClass, boolean>>(ALL_VISIBLE);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 480 });
  // Output container, chosen by the user (default .xs, like every other page).
  // Independent of the uploaded file's format — either input exports as either.
  const [exportFormat, setExportFormat] = useState<ForgeFormat>(DEFAULT_OUTPUT_FORMAT);

  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // capture the current file name for use in the worker response handler
  const stateRef = useRef<State>(state);
  stateRef.current = state;

  // persist config (incl. per-stage params) to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CONFIG_LS_KEY, JSON.stringify(config));
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, [config]);

  // one persistent worker for the page lifetime
  useEffect(() => {
    const w = new ForgeWorker();
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<ForgeResponse>) => {
      const msg = ev.data;
      if (msg.type === "parsed") {
        const currentState = stateRef.current;
        const fileName = currentState.kind === "loading" ? currentState.fileName : "file.xcs";
        setState({
          kind: "ready",
          fileName,
          objects: msg.objects,
          targetIds: msg.targetIds,
          preservedIds: msg.preservedIds,
          format: msg.format,
        });
        setSelectedIncise(msg.targetIds.length === 1 ? msg.targetIds[0] : null);
      } else if (msg.type === "generated") {
        setResult(msg.result);
      } else if (msg.type === "exported") {
        downloadBuf(msg.buf, msg.format);
      } else if (msg.type === "error") {
        notify(msg.message, "error");
        setState({ kind: "error", message: msg.message });
      }
    };
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canvas fills its grid cell: the wrapper is the flex-1 cell and the
  // ResizeObserver feeds BOTH dimensions to the canvas (no width-derived
  // aspect ratio — height is whatever the viewport row leaves us).
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

  // source contours (one per subpath) scaled to mm space so they align with
  // generated paths in the preview canvas
  const sourceContour: Contour[] | null = useMemo(() => {
    if (state.kind !== "ready" || !selectedIncise) return null;
    const obj = state.objects.find((o) => o.id === selectedIncise);
    if (!obj?.dPath) return null;
    const subpaths = splitSubpaths(obj.dPath);
    if (subpaths.length === 0) return null;
    // scale raw path units → mm so both source and generated paths share mm space
    const mmPerUnit = result?.stats.mmPerUnit ?? 1;
    if (mmPerUnit === 1) return subpaths;
    return subpaths.map((c) => ({
      points: c.points.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit })),
      closed: c.closed,
    }));
  }, [state, selectedIncise, result?.stats.mmPerUnit]);

  // debounced regenerate on config / selection change
  useEffect(() => {
    if (state.kind !== "ready" || !selectedIncise) return;
    const t = setTimeout(() => {
      const req: ForgeRequest = { type: "generate", inciseId: selectedIncise, config };
      workerRef.current?.postMessage(req);
    }, 150);
    return () => clearTimeout(t);
  }, [state, selectedIncise, config]);

  function handleFile(f: File) {
    setState({ kind: "loading", fileName: f.name });
    setResult(null);
    f.arrayBuffer()
      .then((buf) => {
        const req: ForgeRequest = { type: "parse", buf };
        workerRef.current?.postMessage(req, [buf]);
      })
      .catch((err: unknown) => {
        // A failed read (revoked blob, OS error) rejects before any worker
        // message, so without this the page would hang on "Parsing…" forever.
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message: `Could not read ${f.name}: ${message}` });
      });
  }

  // Download the exported bytes with a name + MIME matching the chosen output
  // format. `.xs` is a v2 ZIP bundle; `.xcs` is the legacy flat JSON. Either
  // input can be exported as either — the format follows the page's toggle.
  function downloadBuf(buf: ArrayBuffer, format: ForgeFormat) {
    const isXs = format === "xs";
    const blob = new Blob([buf], {
      type: isXs ? "application/zip" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isXs ? "contour-forge.xs" : "contour-forge.xcs";
    a.click();
    URL.revokeObjectURL(url);
  }

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
    state.kind === "ready" &&
    !!selectedIncise &&
    validation.errors.length === 0 &&
    !!result;

  function onExport() {
    if (!selectedIncise) return;
    const req: ForgeRequest = {
      type: "export",
      inciseId: selectedIncise,
      config,
      format: exportFormat,
    };
    workerRef.current?.postMessage(req);
  }

  return (
    <div
      className="relative flex flex-col"
      // The TopBar is 56 px (h-14). Subtract it so the workbench sizes exactly
      // to the available viewport — the rails scroll internally, never the page.
      style={{ height: "calc(100dvh - 56px)" }}
    >
      {/* Diagonal warp backdrop — quiet, always-on brand motif. */}
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
        {/* header row: title · file · actions */}
        <div className="shrink-0 flex items-center gap-3 pb-2">
          <h1 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-ink-subtle)]">
            Contour Forge
          </h1>
          {state.kind === "ready" && (
            <span className="font-mono text-xs text-[var(--color-ink-muted)]">
              {state.fileName}
            </span>
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
            <Button disabled={!canExport} onClick={onExport}>
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
              description="Legacy .xcs and xcs-workspace-v2 .xs bundles are both supported; the export round-trips back to whichever you uploaded. The file needs at least one incise (INTAGLIO) contour — the cut target. Forge converts the selected contour into staged seed / perforate / deepen / clean cut paths; any emboss or score layers are preserved untouched."
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
            {/* instrument readout: always visible, never reflows */}
            <div className="shrink-0 pt-3">
              <ForgeEstimateStrip estimate={result?.stats.estimate ?? null} />
            </div>

            {/* workbench: rails scroll internally, canvas takes the slack */}
            <div className="flex-1 min-h-0 pt-3 grid grid-cols-[248px_minmax(0,1fr)_332px] gap-3 items-stretch">
              {/* LEFT: source & validation */}
              <div className="min-h-0 overflow-y-auto pr-1 flex flex-col gap-3 text-xs">
                <Card>
                  <CardHeader>
                    <CardTitle>Validation</CardTitle>
                  </CardHeader>
                  <div className="p-2 flex flex-col gap-1">
                    {validation.errors.length === 0 ? (
                      <Badge variant="accent">ready</Badge>
                    ) : (
                      validation.errors.map((e, i) => (
                        <Badge key={i} variant="destructive" className="block w-full whitespace-normal break-words rounded-md text-left py-1">
                          {e}
                        </Badge>
                      ))
                    )}
                    {validation.warnings.map((w, i) => (
                      <Badge key={`w${i}`} variant="warning" className="block w-full whitespace-normal break-words rounded-md text-left py-1">
                        {w}
                      </Badge>
                    ))}
                  </div>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Cut target</CardTitle>
                  </CardHeader>
                  <div className="p-2 font-mono flex flex-col gap-1">
                    {state.targetIds.map((id) => {
                      const o = state.objects.find((x) => x.id === id);
                      return (
                        <label key={id} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="incise"
                            checked={selectedIncise === id}
                            onChange={() => setSelectedIncise(id)}
                          />
                          {id.slice(0, 8)} · {o?.processingType ?? "INTAGLIO"}
                        </label>
                      );
                    })}
                  </div>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Preserved layers</CardTitle>
                  </CardHeader>
                  <div className="p-2 font-mono flex flex-col gap-1 text-[var(--color-ink-muted)]">
                    {state.preservedIds.length === 0 ? (
                      <span>None — only the cut target is present.</span>
                    ) : (
                      <>
                        {state.preservedIds.map((id) => {
                          const o = state.objects.find((x) => x.id === id);
                          return (
                            <div key={id}>
                              {id.slice(0, 8)} · {o?.processingType ?? "—"}
                            </div>
                          );
                        })}
                        <span className="mt-1 text-[10px]">passed through untouched</span>
                      </>
                    )}
                  </div>
                </Card>
              </div>

              {/* CENTER: preview fills the column; legend rides with it */}
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
                  {/* legend doubles as the layer-visibility filter */}
                  <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pt-2">
                    {CLASSES.map((c) => (
                      <label
                        key={c}
                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-muted)] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={visible[c]}
                          onChange={() => setVisible((v) => ({ ...v, [c]: !v[c] }))}
                        />
                        <span
                          className="inline-block h-3 w-3 rounded-[2px] border border-black/10"
                          style={{ backgroundColor: CLASS_COLOR[c] }}
                          aria-hidden
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                </Card>

                {/* per-stage laser params: docked open under the canvas so the
                    preview and estimate stay in view while editing */}
                <div className="shrink-0 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
                    <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
                      Stage parameters
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-[var(--color-ink-subtle)]">
                      per-stage laser overrides · applied on export
                    </span>
                  </div>
                  {/* Sized to content — the canvas gives up the space instead.
                      The max-h is only a guard for very tall tab states. */}
                  <div className="max-h-[480px] overflow-y-auto">
                    <ForgeStageParams
                      frameless
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

              {/* RIGHT: strategy & stage controls, scrolls internally */}
              <div className="min-h-0 overflow-y-auto pr-1 flex flex-col gap-3">
                <ForgeControls
                  config={config}
                  onChange={setConfig}
                  visible={visible}
                  onToggleVisible={(c) => setVisible((v) => ({ ...v, [c]: !v[c] }))}
                />
                <ForgeDebugPanel stats={result?.stats ?? null} optimizeScanAngle={config.optimizeScanAngle} />
              </div>
            </div>
          </>
        )}
      </PageContainer>
    </div>
  );
}
