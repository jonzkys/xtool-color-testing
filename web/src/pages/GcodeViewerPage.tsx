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
import { GcodeCanvas } from "../components/gcode/GcodeCanvas";
import type { GcodeFile, Layer } from "../lib/gcode/types";
import type { ParserResponse } from "../lib/gcode/parser.worker";
import ParserWorker from "../lib/gcode/parser.worker?worker";

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
    for (const seg of block.segments) {
      if (seg.s > max) max = seg.s;
    }
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
  const [layerIdx, setLayerIdx] = useState(0);
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
  const safeLayerIdx = Math.min(layerIdx, layers.length - 1);
  const currentLayer: Layer | null = layers[safeLayerIdx] ?? null;

  function handleFile(f: File) {
    setJobIdx(0);
    setLayerIdx(0);
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
        <div className="grid md:grid-cols-[220px_minmax(0,1fr)_280px] grid-cols-1 gap-3 min-h-[560px]">
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
                const isSelected = i === safeLayerIdx;
                const segCount = layer.totalSegments;
                const blockCount = layer.blocks.length;

                return (
                  <button
                    key={i}
                    role="option"
                    aria-selected={isSelected}
                    data-selected={isSelected ? "" : undefined}
                    onClick={() => setLayerIdx(i)}
                    className={[
                      "w-full text-left px-3 py-2",
                      "border-b border-[color:var(--color-border)] last:border-b-0",
                      "hover:bg-[color:var(--color-surface-elevated)] transition-colors duration-75",
                      isSelected
                        ? "bg-[color:var(--color-primary-tint)] border-l-2 border-l-[color:var(--color-primary)] pl-[10px]"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {/* Row 1 */}
                    <div className="flex items-center gap-2 font-mono text-[11px] text-[color:var(--color-ink)]">
                      {/* Index chip */}
                      <span className="font-mono text-[10px] font-semibold bg-[color:var(--color-surface-elevated)] border border-[color:var(--color-border-strong)] rounded-[3px] px-1.5 py-[1px] min-w-[28px] text-center">
                        L{layer.index}
                      </span>
                      {/* Kind badge */}
                      <Badge variant={lKind === "bitmap" ? "info" : "accent"} size="sm">
                        {lKind}
                      </Badge>
                      {/* Peak power */}
                      {lPeak !== null && <span>S {lPeak}</span>}
                    </div>
                    {/* Row 2 */}
                    <div className="mt-[2px] font-mono text-[10px] text-[color:var(--color-ink-subtle)]">
                      {blockCount} blk&nbsp;·&nbsp;{segCount.toLocaleString()} seg
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Column 2 — Canvas */}
          <div
            ref={canvasHostRef}
            className="rounded-[10px] border border-[color:var(--color-border)] overflow-hidden flex items-stretch bg-[color:var(--color-substrate)]"
          >
            <GcodeCanvas
              layer={currentLayer}
              width={canvasSize.w}
              height={canvasSize.h}
              showTravels={showTravels}
            />
          </div>

          {/* Column 3 — Params box */}
          <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] overflow-y-auto h-full flex flex-col">
            {currentLayer ? (
              <>
                {/* Metadata block */}
                <div className="px-3 pt-3 pb-2 border-b border-[color:var(--color-border)] font-mono text-[11px] flex flex-col gap-[3px]">
                  {(
                    [
                      [
                        "BBOX",
                        `(${currentLayer.bbox.minX.toFixed(2)}, ${currentLayer.bbox.minY.toFixed(2)}) → (${currentLayer.bbox.maxX.toFixed(2)}, ${currentLayer.bbox.maxY.toFixed(2)})`,
                      ],
                      [
                        "SIZE",
                        `${(currentLayer.bbox.maxX - currentLayer.bbox.minX).toFixed(2)} × ${(currentLayer.bbox.maxY - currentLayer.bbox.minY).toFixed(2)} mm`,
                      ],
                      ["BLOCKS", String(currentLayer.blocks.length)],
                      ["SEGS", currentLayer.totalSegments.toLocaleString()],
                      ["CONFIG", `${currentLayer.config.raw.length} B`],
                    ] as [string, string][]
                  ).map(([label, value]) => (
                    <div key={label} className="flex items-baseline gap-2">
                      <span className="text-[color:var(--color-ink-subtle)] uppercase tracking-[0.06em] text-[10px] font-semibold shrink-0 w-[52px]">
                        {label}
                      </span>
                      <span className="text-[color:var(--color-ink)] break-all">{value}</span>
                    </div>
                  ))}
                </div>

                {/* JSON block */}
                <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.6] whitespace-pre">
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
        </div>

        {/* Slider row */}
        <div className="flex items-center gap-3 py-2 px-1 mt-1">
          <span className="font-mono text-[12px] text-[color:var(--color-ink-muted)] whitespace-nowrap min-w-[80px]">
            Layer {safeLayerIdx + 1} / {layers.length}
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, layers.length - 1)}
            value={safeLayerIdx}
            onChange={(e) => setLayerIdx(Number(e.target.value))}
            disabled={layers.length <= 1}
            className="flex-1 cursor-pointer disabled:cursor-default disabled:opacity-40"
            style={{ accentColor: "var(--color-primary)" }}
          />
        </div>
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
                setLayerIdx(0);
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
