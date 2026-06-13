// web/src/hooks/useForgeEngine.ts
//
// Shared engine plumbing for the Forge/Spiral cockpit pages: one persistent
// Web Worker, the idle → loading → ready → error state machine, file parse,
// 150 ms-debounced regenerate on config/selection change, and export+download.
//
// The page owns the ForgeConfig (and the controls that mutate it) and passes it
// in; the hook owns everything worker-side plus the selected cut target (which
// it auto-selects on parse when there's exactly one). Both ForgePage (eventually)
// and SpiralPage compose from this so the wiring lives in one place.
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "../ui";
import ForgeWorker from "../lib/forge/forge.worker?worker";
import type { ForgeFormat, ForgeRequest, ForgeResponse } from "../lib/forge/forge.worker";
import type { ForgeConfig, PipelineResult, XcsObject } from "../lib/forge/types";

export type ForgeEngineState =
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

export interface ForgeEngine {
  state: ForgeEngineState;
  result: PipelineResult | null;
  selectedIncise: string | null;
  setSelectedIncise: (id: string | null) => void;
  /** Read a dropped/chosen file and kick off a parse. */
  handleFile: (f: File) => void;
  /** Parse an already-read project buffer (e.g. SVG converted via svg-stack). */
  loadBuffer: (buf: ArrayBuffer, fileName: string) => void;
  /** Export the current config for the selected target in the given format. */
  exportAs: (format: ForgeFormat) => void;
}

/** Download exported bytes with a name + MIME matching the chosen container.
 *  `.xs` is a v2 ZIP bundle; `.xcs` is the legacy flat JSON. */
function downloadBuf(buf: ArrayBuffer, format: ForgeFormat) {
  const isXs = format === "xs";
  const blob = new Blob([buf], { type: isXs ? "application/zip" : "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = isXs ? "contour-forge.xs" : "contour-forge.xcs";
  a.click();
  URL.revokeObjectURL(url);
}

export function useForgeEngine(config: ForgeConfig): ForgeEngine {
  const [state, setState] = useState<ForgeEngineState>({ kind: "idle" });
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [selectedIncise, setSelectedIncise] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  // The worker's onmessage closure is installed once; read the live state
  // through a ref so "parsed" can recover the in-flight file name.
  const stateRef = useRef<ForgeEngineState>(state);
  stateRef.current = state;

  // One persistent worker for the hook's lifetime.
  useEffect(() => {
    const w = new ForgeWorker();
    workerRef.current = w;
    w.onmessage = (ev: MessageEvent<ForgeResponse>) => {
      const msg = ev.data;
      if (msg.type === "parsed") {
        const cur = stateRef.current;
        const fileName = cur.kind === "loading" ? cur.fileName : "file.xcs";
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
  }, []);

  // Debounced regenerate on config / selection change.
  useEffect(() => {
    if (state.kind !== "ready" || !selectedIncise) return;
    const t = setTimeout(() => {
      const req: ForgeRequest = { type: "generate", inciseId: selectedIncise, config };
      workerRef.current?.postMessage(req);
    }, 150);
    return () => clearTimeout(t);
  }, [state, selectedIncise, config]);

  /** Mark loading and hand an already-read project buffer to the worker. Used
   *  directly when the bytes come from somewhere other than a File read (e.g.
   *  an SVG converted via /api/svg-stack). Stable identity (only stable refs +
   *  state setters inside) so consumers can safely list it in effect deps. */
  const loadBuffer = useCallback((buf: ArrayBuffer, fileName: string) => {
    setState({ kind: "loading", fileName });
    setResult(null);
    const req: ForgeRequest = { type: "parse", buf };
    workerRef.current?.postMessage(req, [buf]);
  }, []);

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

  function exportAs(format: ForgeFormat) {
    if (!selectedIncise) return;
    const req: ForgeRequest = { type: "export", inciseId: selectedIncise, config, format };
    workerRef.current?.postMessage(req);
  }

  return { state, result, selectedIncise, setSelectedIncise, handleFile, loadBuffer, exportAs };
}
