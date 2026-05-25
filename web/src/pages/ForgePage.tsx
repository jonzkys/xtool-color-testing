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
import { flattenDPath, normaliseContour } from "../lib/forge/contour";
import { ForgeCanvas } from "../components/forge/ForgeCanvas";
import { ForgeControls } from "../components/forge/ForgeControls";
import { ForgeDebugPanel } from "../components/forge/ForgeDebugPanel";

type State =
  | { kind: "idle" }
  | { kind: "loading"; fileName: string }
  | {
      kind: "ready";
      fileName: string;
      objects: XcsObject[];
      embossIds: string[];
      inciseIds: string[];
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
  const [config, setConfig] = useState<ForgeConfig>(DEFAULT_CONFIG);
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
          embossIds: msg.embossIds,
          inciseIds: msg.inciseIds,
        });
        setSelectedIncise(msg.inciseIds.length === 1 ? msg.inciseIds[0] : null);
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

  // source contour scaled to mm space so it aligns with generated paths in preview
  const sourceContour: Contour | null = useMemo(() => {
    if (state.kind !== "ready" || !selectedIncise) return null;
    const obj = state.objects.find((o) => o.id === selectedIncise);
    if (!obj?.dPath) return null;
    const raw = normaliseContour(flattenDPath(obj.dPath));
    // scale raw path units → mm so both source and generated paths share mm space
    const mmPerUnit = result?.stats.mmPerUnit ?? 1;
    if (mmPerUnit === 1) return raw;
    return {
      points: raw.points.map((p) => ({ x: p.x * mmPerUnit, y: p.y * mmPerUnit })),
      closed: raw.closed,
    };
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
    f.arrayBuffer().then((buf) => {
      const req: ForgeRequest = { type: "parse", buf };
      workerRef.current?.postMessage(req, [buf]);
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
      if (state.embossIds.length === 0) errors.push("No emboss-mode (RELIEF) object found.");
      if (state.inciseIds.length === 0) errors.push("No incise-mode (INTAGLIO) object found.");
      if (state.inciseIds.length > 1 && !selectedIncise)
        errors.push("Multiple incise objects — select a target contour.");
      const obj = selectedIncise ? state.objects.find((o) => o.id === selectedIncise) : null;
      if (selectedIncise && !obj?.dPath)
        errors.push("Selected incise object is not a usable vector/path contour.");
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
            description="The file must contain one emboss (RELIEF) object and one incise (INTAGLIO) contour. The incise contour is used as source geometry to generate staged seed / perforate / deepen / clean cut paths."
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
                  <CardTitle>Emboss objects</CardTitle>
                </CardHeader>
                <div className="p-2 font-mono">
                  {state.embossIds.map((id) => (
                    <div key={id}>
                      {id.slice(0, 8)} · RELIEF
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Incise objects</CardTitle>
                </CardHeader>
                <div className="p-2 font-mono flex flex-col gap-1">
                  {state.inciseIds.map((id) => (
                    <label key={id} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="incise"
                        checked={selectedIncise === id}
                        onChange={() => setSelectedIncise(id)}
                      />
                      {id.slice(0, 8)} · INTAGLIO
                    </label>
                  ))}
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
          </div>
        )}
      </Section>
    </PageContainer>
  );
}
