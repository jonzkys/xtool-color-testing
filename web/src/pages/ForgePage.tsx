import { useEffect, useMemo, useRef, useState } from "react";
import {
  PageContainer,
  Section,
  Toolbar,
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
import type { ForgeRequest, ForgeResponse } from "../lib/forge/forge.worker";
import type {
  Contour,
  ForgeConfig,
  GeneratedClass,
  PipelineResult,
  XcsObject,
} from "../lib/forge/types";
import { DEFAULT_CONFIG } from "../lib/forge/defaults";
import { splitSubpaths } from "../lib/forge/contour";
import { ForgeCanvas } from "../components/forge/ForgeCanvas";
import { ForgeControls } from "../components/forge/ForgeControls";
import { ForgeDebugPanel } from "../components/forge/ForgeDebugPanel";
import { ForgeStageParams } from "../components/forge/ForgeStageParams";

const CONFIG_LS_KEY = "forge.config.v1";

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
      stageParams: p.stageParams ?? {},
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
    }
  | { kind: "error"; message: string };

const ALL_VISIBLE: Record<GeneratedClass, boolean> = {
  seed: true,
  perforate: true,
  deepen: true,
  clean: true,
};

export function ForgePage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [config, setConfig] = useState<ForgeConfig>(loadConfig);
  const [selectedIncise, setSelectedIncise] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [visible, setVisible] = useState<Record<GeneratedClass, boolean>>(ALL_VISIBLE);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 480 });

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
        });
        setSelectedIncise(msg.targetIds.length === 1 ? msg.targetIds[0] : null);
      } else if (msg.type === "generated") {
        setResult(msg.result);
      } else if (msg.type === "exported") {
        downloadBuf(msg.buf);
      } else if (msg.type === "error") {
        notify(msg.message, "error");
        setState({ kind: "error", message: msg.message });
      }
    };
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // responsive canvas
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setCanvasSize({
        w: Math.max(320, el.clientWidth),
        h: Math.max(320, Math.round(el.clientWidth * 0.8)),
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

  function downloadBuf(buf: ArrayBuffer) {
    const blob = new Blob([buf], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contour-forge.xcs";
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
    const req: ForgeRequest = { type: "export", inciseId: selectedIncise, config };
    workerRef.current?.postMessage(req);
  }

  return (
    <PageContainer>
      <Section title="Contour Forge" dense>
        <Toolbar
          trailing={
            <>
              <label className="px-3 py-1.5 text-xs font-mono uppercase rounded bg-[var(--color-primary)] text-white cursor-pointer hover:bg-[var(--color-primary-hover)] transition-colors">
                Upload .xcs
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xcs,application/json"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <Button disabled={!canExport} onClick={onExport}>
                Export modified .xcs
              </Button>
            </>
          }
        >
          {state.kind === "ready" && (
            <span className="font-mono text-xs text-[var(--color-ink-muted)]">
              {state.fileName}
            </span>
          )}
        </Toolbar>
        <MetalBar variant="soft" />

        {state.kind === "idle" && (
          <EmptyState
            title="Upload an xTool .xcs"
            description="The file needs at least one incise (INTAGLIO) contour — the cut target. Forge converts the selected contour into staged seed / perforate / deepen / clean cut paths; any emboss or score layers are preserved untouched."
          />
        )}
        {state.kind === "loading" && (
          <div className="p-6 font-mono text-sm text-[var(--color-ink-muted)]">
            Parsing {state.fileName}…
          </div>
        )}
        {state.kind === "error" && (
          <div className="p-6 font-mono text-sm text-[color:var(--color-destructive)]">
            Error: {state.message}
          </div>
        )}

        {state.kind === "ready" && (
          <div className="grid grid-cols-[260px_1fr_320px] gap-3">
            {/* LEFT: validation + object lists */}
            <div className="flex flex-col gap-3 text-xs">
              <Card>
                <CardHeader>
                  <CardTitle>Validation</CardTitle>
                </CardHeader>
                <div className="p-2 flex flex-col gap-1">
                  {validation.errors.length === 0 ? (
                    <Badge variant="accent">ready</Badge>
                  ) : (
                    validation.errors.map((e, i) => (
                      <Badge key={i} variant="destructive">
                        {e}
                      </Badge>
                    ))
                  )}
                  {validation.warnings.map((w, i) => (
                    <Badge key={`w${i}`} variant="warning">
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

            {/* CENTER: preview */}
            <div ref={canvasWrapRef} className="min-w-0">
              <ForgeCanvas
                source={sourceContour}
                paths={result?.paths ?? []}
                visible={visible}
                width={canvasSize.w}
                height={canvasSize.h}
              />
            </div>

            {/* RIGHT: controls + debug */}
            <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-160px)]">
              <ForgeControls
                config={config}
                onChange={setConfig}
                visible={visible}
                onToggleVisible={(c) => setVisible((v) => ({ ...v, [c]: !v[c] }))}
              />
              <ForgeDebugPanel stats={result?.stats ?? null} />
            </div>

            {/* BOTTOM (full width): per-stage laser params */}
            <div className="col-span-3">
              <ForgeStageParams config={config} onChange={setConfig} />
            </div>
          </div>
        )}
      </Section>
    </PageContainer>
  );
}
