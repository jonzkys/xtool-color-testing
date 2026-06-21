import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileSearch2, AlertCircle, Upload } from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  MetalBar,
  PageContainer,
  Section,
  Select,
  Toolbar,
} from "../ui";
import { GcodeCanvas, type GcodeRenderItem } from "../components/gcode/GcodeCanvas";
import { LayerPanel } from "../components/gcode/LayerPanel";
import type { BBox, GcodeFile, Layer } from "../lib/gcode/types";
import type { ParserResponse } from "../lib/gcode/parser.worker";
import ParserWorker from "../lib/gcode/parser.worker?worker";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyBbox(): BBox {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}


// ─── State machine ────────────────────────────────────────────────────────────

type State =
  | { kind: "idle" }
  | { kind: "loading"; fileName: string }
  | { kind: "ready"; fileName: string; file: GcodeFile; elapsedMs: number }
  | { kind: "error"; fileName: string; message: string };

// ─── JSON coloriser (~30 lines) ───────────────────────────────────────────────

function coloriseJson(raw: string): ReactNode[] {
  // One regex pass over the pretty-printed string.
  // Group 1: key strings ("...":)  Group 2: string values  Group 3: numbers
  // Group 4: booleans/null  Group 5: structural punctuation/whitespace
  const TOKEN =
    /("(?:[^"\\]|\\.)*"(?=\s*:))|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])|(\s+)/g;

  const nodes: ReactNode[] = [];
  let match: RegExpExecArray | null;
  let cursor = 0;
  let idx = 0;

  while ((match = TOKEN.exec(raw)) !== null) {
    // Emit any literal run before this match (shouldn't happen with the
    // whitespace group, but guards against gaps)
    if (match.index > cursor) {
      nodes.push(raw.slice(cursor, match.index));
    }
    const [full, key, str, num, bool, punct, ws] = match;
    if (ws) {
      nodes.push(ws);
    } else if (key) {
      nodes.push(
        <span key={idx} className="text-[color:var(--color-secondary)]">
          {full}
        </span>,
      );
    } else if (str) {
      nodes.push(
        <span key={idx} className="text-[color:var(--color-success)]">
          {full}
        </span>,
      );
    } else if (num) {
      nodes.push(
        <span key={idx} className="text-[color:var(--color-primary)]">
          {full}
        </span>,
      );
    } else if (bool) {
      nodes.push(
        <span key={idx} className="text-[color:var(--color-warning)]">
          {full}
        </span>,
      );
    } else if (punct) {
      nodes.push(
        <span key={idx} className="text-[color:var(--color-ink-muted)]">
          {full}
        </span>,
      );
    }
    cursor = match.index + full.length;
    idx++;
  }
  // Trailing literal run
  if (cursor < raw.length) nodes.push(raw.slice(cursor));
  return nodes;
}

// ─── Layer helpers ────────────────────────────────────────────────────────────

function layerKind(layer: Layer): "vector" | "bitmap" {
  if (layer.blocks.length === 0) return "vector";
  // Try to detect from parsed config. xTool bitmap blocks typically have
  // a "type" or "image" field. We use a heuristic on the raw JSON.
  try {
    const p = layer.config.parsed as Record<string, unknown>;
    if (
      p &&
      typeof p === "object" &&
      ("image" in p || p["type"] === "bitmap" || p["type"] === "image")
    ) {
      return "bitmap";
    }
  } catch {
    // ignore
  }
  return "vector";
}

function layerPeakPower(layer: Layer): number | null {
  let max = 0;
  for (const block of layer.blocks) {
    if (block.peakS > max) max = block.peakS;
  }
  return max > 0 ? max : null;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke="var(--color-primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="38"
        strokeDashoffset="28"
      />
    </svg>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export function GcodeViewerPage() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [jobIdx, setJobIdx] = useState(0);
  /** Sorted unique layer indices currently selected. 1 = single-layer
   * view (full canvas + params rail). 2+ = multi-layer comparison
   * view (grid of LayerPanels, no right rail). */
  const [selectedLayerIdxs, setSelectedLayerIdxs] = useState<number[]>([0]);
  /** Shared block offset applied to every selected layer. Each panel
   * clamps to its own block count so it stays parked at its last
   * block if the offset runs past. Default 0 = show the first block
   * of every selected layer (forensic comparison starts at the
   * beginning, not with everything overlaid). */
  const [blockOffset, setBlockOffset] = useState(0);
  const [showTravels, setShowTravels] = useState(true);

  // Canvas resize tracking
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 400, h: 400 });

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setCanvasSize({ w: Math.round(width), h: Math.round(height) });
        }
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // File input ref for the hidden <input>
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Derived data
  const file = state.kind === "ready" ? state.file : null;
  const job = file ? (file.jobs[jobIdx] ?? file.jobs[0] ?? null) : null;
  const layers = job ? job.layers : [];
  /** Filter selection to indices that still point at real layers (in
   * case the file changed under us). The first such index is the
   * "focused" one used for the right-rail params box. */
  const safeSelectedIdxs = useMemo(
    () => selectedLayerIdxs.filter((i) => i >= 0 && i < layers.length),
    [selectedLayerIdxs, layers.length],
  );
  const isMulti = safeSelectedIdxs.length > 1;
  const focusedLayerIdx = safeSelectedIdxs[0] ?? null;
  const currentLayer: Layer | null =
    focusedLayerIdx != null ? layers[focusedLayerIdx] : null;
  /** Max blocks across the selected layers — drives the slider's max
   * value so the user can scrub to the longest layer's last block. */
  const sharedMaxBlocks = useMemo(() => {
    let m = 0;
    for (const i of safeSelectedIdxs) {
      const l = layers[i];
      if (l && l.blocks.length > m) m = l.blocks.length;
    }
    return m;
  }, [safeSelectedIdxs, layers]);

  function toggleLayer(i: number) {
    setBlockOffset(0);
    setSelectedLayerIdxs((prev) => {
      if (prev.includes(i)) {
        const next = prev.filter((x) => x !== i);
        // Don't allow zero selection — keep at least the clicked one
        // so the page always shows something.
        return next.length === 0 ? [i] : next;
      }
      return [...prev, i].sort((a, b) => a - b);
    });
  }
  function selectOnlyLayer(i: number) {
    setSelectedLayerIdxs([i]);
    setBlockOffset(0);
  }

  // ── Canvas inputs (derived from mode + slider state) ─────────────────────────

  /** Configured peak power for a layer, or null when blockConfig.power
   * isn't present (vector blocks). Used for cleanup detection. */
  function configuredPeakOf(layer: Layer): number | null {
    const p = layer.config.parsed as { power?: unknown } | null;
    if (!p) return null;
    const arr = (p as { power?: unknown }).power;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const last = arr[arr.length - 1];
    return typeof last === "number" ? last : null;
  }

  // Compose canvas inputs for the single-layer view (only used when
  // exactly one layer is selected). The multi-layer view doesn't go
  // through this — each LayerPanel computes its own.
  const canvasInputs = useMemo(() => {
    if (!currentLayer) {
      return {
        items: [] as GcodeRenderItem[],
        bbox: emptyBbox(),
        caption: "",
      };
    }
    const peak = configuredPeakOf(currentLayer);
    const safeBlockIdx =
      blockOffset != null &&
      blockOffset >= 0 &&
      blockOffset < currentLayer.blocks.length
        ? blockOffset
        : null;
    const blocks =
      safeBlockIdx == null
        ? currentLayer.blocks
        : [currentLayer.blocks[safeBlockIdx]];
    return {
      items: blocks.map((block) => ({ block, configuredPeak: peak })),
      bbox: currentLayer.bbox,
      caption:
        safeBlockIdx == null
          ? `${currentLayer.blocks.length} blocks`
          : `block ${safeBlockIdx + 1} / ${currentLayer.blocks.length}`,
    };
  }, [currentLayer, blockOffset]);

  function handleFile(f: File) {
    setJobIdx(0);
    setSelectedLayerIdxs([0]);
    setBlockOffset(0);
    setState({ kind: "loading", fileName: f.name });
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") {
        setState({ kind: "error", fileName: f.name, message: "Could not read file as text." });
        return;
      }
      const worker = new ParserWorker();
      worker.onmessage = (ev: MessageEvent<ParserResponse>) => {
        worker.terminate();
        const resp = ev.data;
        if (resp.type === "parsed") {
          setState({
            kind: "ready",
            fileName: f.name,
            file: resp.file,
            elapsedMs: Math.round(resp.elapsedMs),
          });
        } else {
          setState({ kind: "error", fileName: f.name, message: resp.message });
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        setState({ kind: "error", fileName: f.name, message: err.message ?? "Worker error." });
      };
      worker.postMessage({ type: "parse", text });
    };
    reader.readAsText(f);
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    // Reset so the same file can be re-opened
    e.target.value = "";
  }

  // Pretty-printed config JSON for the params box
  const configJson = useMemo(() => {
    if (!currentLayer) return null;
    if (currentLayer.config.parsed === null) return null;
    try {
      return JSON.stringify(currentLayer.config.parsed, null, 2);
    } catch {
      return null;
    }
  }, [currentLayer]);

  // ── Toolbar ────────────────────────────────────────────────────────────────

  const toolbarTrailing = (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={showTravels}
        onChange={(e) => setShowTravels(e.target.checked)}
        className="w-3.5 h-3.5 accent-[color:var(--color-primary)] cursor-pointer"
      />
      <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
        Show travels
      </span>
    </label>
  );

  const openButton = (
    <label
      className={[
        "inline-flex items-center justify-center gap-2 whitespace-nowrap",
        "rounded-[6px] font-medium transition-colors cursor-pointer",
        "h-7 px-2.5 text-[12px]",
        "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
        "border border-[color:var(--color-border-strong)]",
        "hover:bg-[color:var(--color-surface-elevated)] hover:border-[color:var(--color-ink-subtle)]",
        "focus-within:ring-2 focus-within:ring-[color:var(--color-primary)] focus-within:ring-offset-2",
      ].join(" ")}
    >
      <Upload size={12} />
      Open .gc file…
      <input
        ref={fileInputRef}
        type="file"
        accept=".gc,.gcode,.nc,text/plain"
        className="sr-only"
        onChange={onFileInputChange}
        tabIndex={0}
      />
    </label>
  );

  const statusChip =
    state.kind === "ready" ? (
      <span className="font-mono text-[12px] text-[color:var(--color-ink-muted)] truncate max-w-[420px]">
        {state.fileName}&nbsp;·&nbsp;{state.file.totalLines.toLocaleString()} lines&nbsp;·&nbsp;
        {state.elapsedMs} ms
      </span>
    ) : null;

  // ── Workspace content ───────────────────────────────────────────────────────

  let workspace: ReactNode;

  if (state.kind === "idle") {
    workspace = (
      <Card
        variant="inset"
        padded={false}
        className="min-h-[400px] flex items-center justify-center col-span-full"
      >
        <EmptyState
          icon={<FileSearch2 size={32} strokeWidth={1.5} />}
          title="No file loaded"
          description="Drop a Studio .gc export here, or click the button above to browse. Files are parsed locally — nothing is uploaded."
          action={
            <label
              className={[
                "inline-flex items-center justify-center gap-2 whitespace-nowrap",
                "rounded-[6px] font-medium transition-colors cursor-pointer",
                "h-7 px-2.5 text-[12px]",
                "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
                "border border-[color:var(--color-border-strong)]",
                "hover:bg-[color:var(--color-surface-elevated)] hover:border-[color:var(--color-ink-subtle)]",
              ].join(" ")}
            >
              Open .gc file…
              <input
                type="file"
                accept=".gc,.gcode,.nc,text/plain"
                className="sr-only"
                onChange={onFileInputChange}
              />
            </label>
          }
        />
      </Card>
    );
  } else if (state.kind === "loading") {
    workspace = (
      <Card
        variant="inset"
        padded={false}
        className="min-h-[400px] flex flex-col items-center justify-center gap-3 col-span-full transition-opacity duration-150"
      >
        <Spinner />
        <span className="font-mono text-[12px] text-[color:var(--color-ink-muted)]">
          Parsing {state.fileName}…
        </span>
      </Card>
    );
  } else if (state.kind === "error") {
    workspace = (
      <div className="col-span-full rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-4 py-3 text-[13px] text-[color:var(--color-destructive)] flex items-center gap-2">
        <AlertCircle size={16} className="shrink-0" />
        <span className="flex-1">Parser error: {state.message}</span>
        <label
          className={[
            "inline-flex items-center justify-center gap-2 whitespace-nowrap ml-auto",
            "rounded-[6px] font-medium transition-colors cursor-pointer shrink-0",
            "h-7 px-2.5 text-[12px]",
            "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
            "border border-[color:var(--color-border-strong)]",
            "hover:bg-[color:var(--color-surface-elevated)]",
          ].join(" ")}
        >
          Try again
          <input
            type="file"
            accept=".gc,.gcode,.nc,text/plain"
            className="sr-only"
            onChange={onFileInputChange}
          />
        </label>
      </div>
    );
  } else {
    // ready — three-column workspace
    workspace = (
      <>
        {/* Three-column grid */}
        <div
          className={
            isMulti
              ? "grid md:grid-cols-[220px_minmax(0,1fr)] grid-cols-1 gap-3 min-h-[560px]"
              : "grid md:grid-cols-[220px_minmax(0,1fr)_280px] grid-cols-1 gap-3 min-h-[560px]"
          }
        >
          {/* Column 1 — Layer list */}
          <div
            role="listbox"
            aria-label="Layers"
            className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] overflow-y-auto h-full"
          >
            {layers.length === 0 ? (
              <p className="px-3 py-3 font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                —
              </p>
            ) : (
              layers.map((layer, i) => {
                const lKind = layerKind(layer);
                const lPeak = layerPeakPower(layer);
                const isFocused = i === focusedLayerIdx;
                const isChecked = safeSelectedIdxs.includes(i);
                const segCount = layer.totalSegments;
                const blockCount = layer.blocks.length;

                return (
                  <div
                    key={i}
                    className={[
                      "border-b border-[color:var(--color-border)] last:border-b-0",
                      isFocused
                        ? "bg-[color:var(--color-primary-tint)] border-l-2 border-l-[color:var(--color-primary)]"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex items-stretch">
                      <label
                        className="flex items-center pl-3 pr-2 cursor-pointer hover:bg-[color:var(--color-surface-elevated)]"
                        title={isChecked ? "Remove from comparison" : "Add to comparison"}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleLayer(i)}
                          className="w-3.5 h-3.5 accent-[color:var(--color-primary)] cursor-pointer"
                        />
                      </label>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isFocused}
                        onClick={() => selectOnlyLayer(i)}
                        className={[
                          "flex-1 text-left pr-3 py-2 pl-1",
                          "hover:bg-[color:var(--color-surface-elevated)] transition-colors duration-75",
                          isFocused ? "pl-[2px]" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <div className="flex items-center gap-2 font-mono text-[11px] text-[color:var(--color-ink)]">
                          <span className="font-mono text-[10px] font-semibold bg-[color:var(--color-surface-elevated)] border border-[color:var(--color-border-strong)] rounded-[3px] px-1.5 py-[1px] min-w-[28px] text-center">
                            L{layer.index}
                          </span>
                          <Badge variant={lKind === "bitmap" ? "info" : "accent"} size="sm">
                            {lKind}
                          </Badge>
                          {lPeak !== null && <span>S {lPeak}</span>}
                        </div>
                        <div className="mt-[2px] font-mono text-[10px] text-[color:var(--color-ink-subtle)]">
                          {blockCount} blk&nbsp;·&nbsp;{segCount.toLocaleString()} seg
                        </div>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Column 2 — Canvas or multi-layer grid */}
          {isMulti ? (
            <div
              className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-2 overflow-auto"
              style={{
                display: "grid",
                gridTemplateColumns:
                  safeSelectedIdxs.length === 2
                    ? "repeat(2, minmax(0, 1fr))"
                    : "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "0.5rem",
                alignContent: "start",
              }}
            >
              {safeSelectedIdxs.map((i) => {
                const layer = layers[i];
                if (!layer) return null;
                return (
                  <LayerPanel
                    key={i}
                    layer={layer}
                    displayIndex={layer.index}
                    blockOffset={blockOffset}
                    showTravels={showTravels}
                  />
                );
              })}
            </div>
          ) : (
            <div
              ref={canvasHostRef}
              className="rounded-[10px] border border-[color:var(--color-border)] overflow-hidden flex items-stretch bg-[color:var(--color-substrate)]"
            >
              <GcodeCanvas
                items={canvasInputs.items}
                bbox={canvasInputs.bbox}
                caption={canvasInputs.caption}
                width={canvasSize.w}
                height={canvasSize.h}
                showTravels={showTravels}
              />
            </div>
          )}

          {/* Column 3 — Params box (single-layer view only). Multi-layer
              comparison surfaces observed stats inline on each panel. */}
          {!isMulti && (
          <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] overflow-y-auto h-full flex flex-col">
            {currentLayer ? (
              <>
                {/* Metadata block — observed values for the current view
                    (single block or whole layer), with cleanup-pass flag. */}
                {(() => {
                  const parsedCfg = currentLayer.config.parsed as { power?: unknown } | null;
                  const configuredPeak = (() => {
                    if (!parsedCfg) return null;
                    const p = (parsedCfg as { power?: unknown }).power;
                    if (!Array.isArray(p) || p.length === 0) return null;
                    const last = p[p.length - 1];
                    return typeof last === "number" ? last : null;
                  })();
                  const singleBlock =
                    blockOffset != null &&
                    blockOffset >= 0 &&
                    blockOffset < currentLayer.blocks.length
                      ? currentLayer.blocks[blockOffset]
                      : null;
                  const peakSs = currentLayer.blocks.map(b => b.peakS).filter(s => s > 0);
                  const layerPeakSMin = peakSs.length > 0 ? Math.min(...peakSs) : 0;
                  const layerPeakSMax = peakSs.length > 0 ? Math.max(...peakSs) : 0;
                  const feeds = currentLayer.blocks.map(b => b.feedF).filter(f => f > 0);
                  const layerFeedMin = feeds.length > 0 ? Math.min(...feeds) : 0;
                  const layerFeedMax = feeds.length > 0 ? Math.max(...feeds) : 0;
                  const cleanupCount =
                    configuredPeak != null
                      ? currentLayer.blocks.filter(
                          b => b.peakS > 0 && b.peakS < configuredPeak * 0.5,
                        ).length
                      : 0;
                  const isCleanup =
                    singleBlock && configuredPeak != null
                      ? singleBlock.peakS > 0 &&
                        singleBlock.peakS < configuredPeak * 0.5
                      : false;
                  const peakSPct =
                    singleBlock && configuredPeak && configuredPeak > 0
                      ? ` (${Math.round((singleBlock.peakS / configuredPeak) * 100)}% of config)`
                      : "";
                  const rangeStr = (lo: number, hi: number, suffix = "") =>
                    lo === hi
                      ? `${lo}${suffix}`
                      : `${lo}–${hi}${suffix}`;
                  // Studio reports speed in mm/s; gcode emits F in mm/min.
                  // Show both, mm/s first so the number matches the Studio UI.
                  const speedStr = (fMin: number) =>
                    fMin > 0
                      ? `${Math.round(fMin / 60).toLocaleString()} mm/s  (F ${fMin})`
                      : "—";
                  const speedRangeStr = (lo: number, hi: number) => {
                    if (lo === 0 && hi === 0) return "—";
                    if (lo === hi) return speedStr(lo);
                    return `${Math.round(lo / 60).toLocaleString()}–${Math.round(hi / 60).toLocaleString()} mm/s  (F ${lo}–${hi})`;
                  };
                  // Anomaly flag for the layer-level view: any block whose
                  // peak S differs from the layer's max (≈ the configured
                  // peak), or whose feed differs from the layer's most
                  // common feed.
                  const peakSAnomaly = peakSs.length > 0 && layerPeakSMin !== layerPeakSMax;
                  const feedAnomaly = feeds.length > 0 && layerFeedMin !== layerFeedMax;
                  // Adaptive decimal places — xTool emits Z deltas of
                  // ~0.003mm at refocus steps which `.toFixed(2)` rounds
                  // to "0.00". Show 3 dp when |v| < 0.1.
                  const fmtZ = (v: number) => {
                    const dp = Math.abs(v) < 0.1 ? 3 : 2;
                    return v.toFixed(dp);
                  };
                  // Z summary: running Z (cumulative head position from
                  // the file's start) is always shown; the delta for the
                  // current view is appended only when the view contains
                  // events that actually changed Z (xTool re-emits the
                  // same Z value before some scan-strips — those events
                  // are not meaningful "changes").
                  const zSummary = (
                    running: number,
                    moves: { z: number; delta: number }[],
                  ) => {
                    const meaningful = moves.filter((m) => m.delta !== 0);
                    if (meaningful.length === 0) {
                      return `${fmtZ(running)} mm`;
                    }
                    const total = meaningful.reduce((n, m) => n + m.delta, 0);
                    const arrow = total < 0 ? "↓" : total > 0 ? "↑" : "—";
                    const eventSuffix =
                      meaningful.length === 1
                        ? ""
                        : `  ·  ${meaningful.length} events`;
                    return `${fmtZ(running)} mm  ·  ${arrow} ${fmtZ(Math.abs(total))} mm${eventSuffix}`;
                  };
                  const layerZMoves = currentLayer.blocks.flatMap((b) => b.zMoves);
                  const lastLayerBlock =
                    currentLayer.blocks[currentLayer.blocks.length - 1];
                  const layerRunningZ = lastLayerBlock ? lastLayerBlock.zAtEnd : 0;
                  const singleZValue = singleBlock
                    ? zSummary(singleBlock.zAtEnd, singleBlock.zMoves)
                    : null;
                  const layerZValue = zSummary(layerRunningZ, layerZMoves);
                  // Z kind reflects direction relative to file start
                  // (negative = head descended below origin, positive =
                  // ascended). The bold "z-change" variant fires when
                  // the current view actually contains Z events.
                  const zKind = (
                    running: number,
                    hasChange: boolean,
                  ): "z-down" | "z-up" | "z-zero" | "z-down-change" | "z-up-change" | "z-zero-change" => {
                    const dir = running < 0 ? "down" : running > 0 ? "up" : "zero";
                    return (hasChange ? `z-${dir}-change` : `z-${dir}`) as
                      | "z-down"
                      | "z-up"
                      | "z-zero"
                      | "z-down-change"
                      | "z-up-change"
                      | "z-zero-change";
                  };
                  type RowKind =
                    | "ok"
                    | "flag"
                    | "anomaly"
                    | "z-down"
                    | "z-up"
                    | "z-zero"
                    | "z-down-change"
                    | "z-up-change"
                    | "z-zero-change";
                  const rows: [string, string, RowKind][] = singleBlock
                    ? [
                        ["VIEW", `Block ${blockOffset! + 1} / ${currentLayer.blocks.length}`, "ok"],
                        ["LINE", `#${singleBlock.startLine.toLocaleString()}`, "ok"],
                        [
                          "BBOX",
                          `(${singleBlock.bbox.minX.toFixed(2)}, ${singleBlock.bbox.minY.toFixed(2)}) → (${singleBlock.bbox.maxX.toFixed(2)}, ${singleBlock.bbox.maxY.toFixed(2)})`,
                          "ok",
                        ],
                        [
                          "SIZE",
                          `${(singleBlock.bbox.maxX - singleBlock.bbox.minX).toFixed(2)} × ${(singleBlock.bbox.maxY - singleBlock.bbox.minY).toFixed(2)} mm`,
                          "ok",
                        ],
                        ["SEGS", singleBlock.geometry.count.toLocaleString(), "ok"],
                        [
                          "PEAK S",
                          `${singleBlock.peakS}${peakSPct}`,
                          isCleanup ? "anomaly" : "ok",
                        ],
                        [
                          "SPEED",
                          speedStr(singleBlock.feedF),
                          isCleanup ? "anomaly" : "ok",
                        ],
                        ["TYPE", isCleanup ? "Cleanup pass" : "Normal pass", isCleanup ? "anomaly" : "ok"],
                        [
                          "Z",
                          singleZValue ?? `${fmtZ(0)} mm`,
                          zKind(
                            singleBlock?.zAtEnd ?? 0,
                            (singleBlock?.zMoves.filter((m) => m.delta !== 0).length ?? 0) > 0,
                          ),
                        ],
                      ]
                    : [
                        ["VIEW", `All ${currentLayer.blocks.length} blocks`, "ok"],
                        [
                          "BBOX",
                          `(${currentLayer.bbox.minX.toFixed(2)}, ${currentLayer.bbox.minY.toFixed(2)}) → (${currentLayer.bbox.maxX.toFixed(2)}, ${currentLayer.bbox.maxY.toFixed(2)})`,
                          "ok",
                        ],
                        [
                          "SIZE",
                          `${(currentLayer.bbox.maxX - currentLayer.bbox.minX).toFixed(2)} × ${(currentLayer.bbox.maxY - currentLayer.bbox.minY).toFixed(2)} mm`,
                          "ok",
                        ],
                        ["BLOCKS", String(currentLayer.blocks.length), "ok"],
                        ["SEGS", currentLayer.totalSegments.toLocaleString(), "ok"],
                        [
                          "PEAK S",
                          peakSs.length > 0 ? rangeStr(layerPeakSMin, layerPeakSMax) : "—",
                          peakSAnomaly ? "anomaly" : "ok",
                        ],
                        [
                          "SPEED",
                          speedRangeStr(layerFeedMin, layerFeedMax),
                          feedAnomaly ? "anomaly" : "ok",
                        ],
                        [
                          "CLEANUP",
                          cleanupCount > 0
                            ? `${cleanupCount} of ${currentLayer.blocks.length} blocks`
                            : "none detected",
                          cleanupCount > 0 ? "anomaly" : "ok",
                        ],
                        [
                          "Z",
                          layerZValue,
                          zKind(
                            layerRunningZ,
                            layerZMoves.some((m) => m.delta !== 0),
                          ),
                        ],
                      ];
                  return (
                    <div className="px-3 pt-3 pb-2 border-b border-[color:var(--color-border)] font-mono text-[11px] flex flex-col gap-[3px]">
                      {rows.map(([label, value, kind]) => (
                        <div key={label} className="flex items-baseline gap-2">
                          <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em] text-[10px] font-semibold shrink-0 w-[58px]">
                            {label}
                          </span>
                          <span
                            className={
                              kind === "anomaly"
                                ? "text-[color:var(--color-destructive)] font-bold break-all"
                                : kind === "flag"
                                ? "text-[color:var(--color-primary)] font-semibold break-all"
                                : kind === "z-down"
                                ? "text-[color:var(--color-success)] break-all"
                                : kind === "z-down-change"
                                ? "text-[color:var(--color-success)] font-bold break-all px-1 -mx-1 rounded-[2px] bg-[color:var(--color-success)]/10"
                                : kind === "z-up"
                                ? "text-[color:var(--color-warning)] break-all"
                                : kind === "z-up-change"
                                ? "text-[color:var(--color-warning)] font-bold break-all px-1 -mx-1 rounded-[2px] bg-[color:var(--color-warning)]/10"
                                : kind === "z-zero"
                                ? "text-[color:var(--color-ink-muted)] break-all"
                                : kind === "z-zero-change"
                                ? "text-[color:var(--color-ink)] font-bold break-all px-1 -mx-1 rounded-[2px] bg-[color:var(--color-surface-elevated)]"
                                : "text-[color:var(--color-ink)] break-all"
                            }
                          >
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* JSON block — the raw blockConfig Studio wrote. Per-block
                    observed values live in the metadata above. */}
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--color-ink-subtle)]">
                  Configured (blockConfig)
                </div>
                <div className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-[11px] leading-[1.6] whitespace-pre">
                  {currentLayer.config.parsed === null ? (
                    <>
                      <div className="text-[color:var(--color-destructive)] mb-1">
                        ⚠ blockConfig is not valid JSON
                      </div>
                      <span className="text-[color:var(--color-destructive)]">
                        {currentLayer.config.raw}
                      </span>
                    </>
                  ) : configJson !== null ? (
                    coloriseJson(configJson)
                  ) : (
                    <span className="text-[color:var(--color-ink-subtle)]">—</span>
                  )}
                </div>
              </>
            ) : (
              <div className="px-3 py-3 font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                —
              </div>
            )}
          </div>
          )}
        </div>

        {/* Block-offset slider.
            Single-layer view: scrubs the focused layer's blocks.
            Multi-layer view: applies the same offset to every selected
            layer (each panel clamps to its own block count). */}
        {sharedMaxBlocks > 1 && (
          <div className="flex items-center gap-3 py-2 px-1 mt-1">
            <span className="font-mono text-[12px] text-[color:var(--color-ink-muted)] whitespace-nowrap min-w-[120px]">
              Block {blockOffset + 1} / {sharedMaxBlocks}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, sharedMaxBlocks - 1)}
              value={blockOffset}
              onChange={(e) => setBlockOffset(Number(e.target.value))}
              className="flex-1 cursor-pointer"
              style={{ accentColor: "var(--color-primary)" }}
            />
          </div>
        )}
      </>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageContainer maxWidth="wide">
      <Section title="Gcode Viewer" dense>
        {/* Toolbar */}
        <Toolbar trailing={toolbarTrailing}>
          {openButton}
          {statusChip}
        </Toolbar>

        <MetalBar variant="soft" className="mb-2" />

        {/* Job bar — only when multiple jobs */}
        {file && file.jobs.length > 1 && (
          <div className="flex items-center gap-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
              Job
            </span>
            <Select
              value={jobIdx}
              onChange={(e) => {
                setJobIdx(Number(e.target.value));
                setSelectedLayerIdxs([0]);
                setBlockOffset(0);
              }}
              className="w-auto"
            >
              {file.jobs.map((j, i) => (
                <option key={i} value={i}>
                  {j.name || `Job ${i + 1}`}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Workspace */}
        {workspace}
      </Section>
    </PageContainer>
  );
}
