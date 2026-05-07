/**
 * Pixel Art — quantise an image into a small grid of colour cells and
 * burn each colour as one compound engrave path (one closed subpath per
 * cell).
 *
 * This page composes three pieces:
 *   - left:   settings (name, material, start, grid, max-K)
 *   - center: ``PixelArtCanvas`` (original + crop on top, preview below)
 *   - right:  ``PixelArtLayerPanel`` (colour rows + actions)
 *
 * The pipeline (sample → quantise → group cells by label) runs on every
 * change to ``crop`` / ``cellsAcross`` / ``maxK`` / ``imageData`` with
 * a small debounce. ``kMeansLab`` returns the labels + centroid hexes;
 * the page derives ``rows`` (one per centroid) from those plus the
 * auto-matched palette entries, and bakes a per-colour SVG d-string for
 * the preview.
 *
 * Skip-engrave is enforced at download time, not in the preview — the
 * preview keeps showing the dimmed cell so the user can see the
 * background hole.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  cn,
  Field,
  Input,
  NumberField,
  PageContainer,
  Section,
  Select,
} from "../ui";
import {
  PixelArtCanvas,
  type CroppedRegion,
  type PreviewState,
} from "../components/PixelArtCanvas";
import {
  PixelArtLayerPanel,
  type PixelArtLayerRow,
} from "../components/PixelArtLayerPanel";
import {
  kMeansLab,
  type KMeansResult,
} from "../components/pixelArtMath";
import { sampleCellGrid } from "../components/pixelArtImage";
import { isNearWhite } from "../color/math";
import { defaultBaseParams } from "../defaults";
import { sanitiseProjectName } from "../projectName";
import type {
  PaletteEntry,
  PixelArtRequest,
  PixelArtRectSpec,
  PixelArtLayerSpec,
} from "../types";
import type { LibraryState } from "../library";
import { listMaterials, listPresets } from "../api/library";
import { listPaletteEntries } from "../api/palette";
import { getCurrentMachineId, useCurrentMachine } from "../state/machine";
import { pixelArtAndDownload, pixelArtSvgAndDownload } from "../generate";
import type { MergeGroup } from "../svg/mergeColors";
import {
  decodeFile,
  defaultCrop,
  materialDims,
  nearestPaletteEntry,
} from "./pixelArtHelpers";

interface PipelineResult extends KMeansResult {
  cols: number;
  rows: number;
  /** Per-cell raw mean hex (#rrggbb) before quantisation, indexed
   *  row-major ``row * cols + col``. ``null`` for skipped cells.
   *  Powers the "Original" preview-mode toggle so the user can A/B
   *  the quantised vs. source-mean rendering without re-running the
   *  pipeline. */
  cellMeansHex: (string | null)[];
}

const DEFAULT_CELLS_ACROSS = 32;
const DEFAULT_MAX_K = 8;
const DEBOUNCE_MS = 150;
/** Bumped from 150ms when the user is driving the crop so the
 *  pipeline doesn't fight the drag. The dedicated re-render button
 *  forces an immediate run when this longer wait is in the way. */
const CROP_DEBOUNCE_MS = 600;

export function PixelArtPage() {
  const { machine } = useCurrentMachine();

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
      .catch(() => {});
  }, []);

  const [paletteEntries, setPaletteEntries] = useState<PaletteEntry[]>([]);

  // Page state
  const [name, setName] = useState("pixel-art");
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [imageData, setImageData] = useState<ImageData | null>(null);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [widthMm, setWidthMm] = useState(50);
  const [heightMm, setHeightMm] = useState(50);
  const [startX, setStartX] = useState(10);
  const [startY, setStartY] = useState(10);
  const [cellsAcross, setCellsAcross] = useState(DEFAULT_CELLS_ACROSS);
  const [maxK, setMaxK] = useState(DEFAULT_MAX_K);
  const [crop, setCrop] = useState<CroppedRegion>({ x: 0, y: 0, w: 1, h: 1 });
  // When off, the crop frame is hidden and ``crop`` is pinned to the
  // image bounds — the burn renders the entire uploaded picture.
  // The user opts into a sub-region by toggling this on; the frame
  // then becomes draggable.
  const [cropEnabled, setCropEnabled] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [enabledByColor, setEnabledByColor] = useState<Record<string, boolean>>({});
  const [matchByColor, setMatchByColor] = useState<Record<string, PaletteEntry | null>>({});
  const [error, setError] = useState<string | undefined>();
  const [generating, setGenerating] = useState(false);
  // Off by default: the burn fits whatever crop the user picks. When
  // on, the crop frame snaps to the material's aspect (the original
  // behaviour). Toggleable in case the user wants the burn to mirror
  // the material outline exactly.
  const [lockAspect, setLockAspect] = useState(false);
  // "representative" = paint each cell with its k-means centroid
  // colour (what gets burned). "original" = paint each cell with its
  // raw source-mean colour (what the source image looks like at this
  // cell resolution). Toggle lives on the preview header.
  const [previewMode, setPreviewMode] = useState<"representative" | "original">(
    "representative",
  );
  // Bumping this counter forces the pipeline effect to re-run even
  // when its other inputs haven't changed. Drives the manual
  // "re-render" button so users dragging the crop frame can flush a
  // stale auto-debounce without waiting it out.
  const [renderTick, setRenderTick] = useState(0);

  // Initial material wiring — once library + active material are
  // known, hydrate the dimensions if the user hasn't picked one.
  useEffect(() => {
    if (materialId == null && library.active_material_id != null) {
      const id = String(library.active_material_id);
      setMaterialId(id);
      const mat = library.materials.find(
        (m) => String(m.id) === id,
      );
      const { widthMm: w, heightMm: h } = materialDims(mat);
      setWidthMm(w);
      setHeightMm(h);
    }
  }, [library, materialId]);

  // ── Palette load (per material) ─────────────────────────────────────
  useEffect(() => {
    if (!materialId) {
      setPaletteEntries([]);
      return;
    }
    const matIdNum = Number(materialId);
    if (!Number.isFinite(matIdNum) || matIdNum <= 0) return;
    let cancelled = false;
    listPaletteEntries({
      material_id: matIdNum,
      machine_id: getCurrentMachineId(),
    })
      .then((rows) => {
        if (!cancelled) setPaletteEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setPaletteEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [materialId]);

  // ── Laser spot floor for cellsAcross ────────────────────────────────
  // The page lets the user drive ``cellsAcross``; cell width can't be
  // smaller than 2× the laser spot or each cell becomes a single pulse
  // and the engrave reads as noise. Take the largest active spot
  // dimension as the floor.
  const laserSpotMm = useMemo(() => {
    if (!machine) return 0.1;
    const lasers = machine.lasers ?? [];
    if (lasers.length === 0) return 0.1;
    const widest = lasers.reduce(
      (m, l) => Math.max(m, l.spot_mm[0], l.spot_mm[1]),
      0,
    );
    return widest > 0 ? widest : 0.1;
  }, [machine]);

  const cellsAcrossMax = useMemo(
    () => Math.max(8, Math.floor(widthMm / (2 * laserSpotMm))),
    [widthMm, laserSpotMm],
  );

  // ── Crop frame off → pin crop to whole image ──────────────────────
  // Without this the crop state lingers from a previous user edit and
  // the canvas/pipeline see a stale subregion. When the toggle goes
  // back on, ``crop`` keeps whatever the user had previously.
  useEffect(() => {
    if (cropEnabled) return;
    if (!image) return;
    if (
      crop.x === 0 &&
      crop.y === 0 &&
      Math.abs(crop.w - image.width) < 0.5 &&
      Math.abs(crop.h - image.height) < 0.5
    ) {
      return;
    }
    setCrop({ x: 0, y: 0, w: image.width, h: image.height });
  }, [cropEnabled, image, crop.x, crop.y, crop.w, crop.h]);

  // ── Burn-height auto-sync ──────────────────────────────────────────
  // When the aspect lock is off, the burn fits the crop's own aspect:
  // ``burn_h = burn_w / cropAspect``. Drive ``heightMm`` to match so
  // the value sent to the backend reflects the actual rendered burn
  // (the cell grid uses widthMm + cropAspect, but heightMm needs to
  // ride along so /generate stamps the right number on the request).
  useEffect(() => {
    if (lockAspect) return;
    if (!imageData) return;
    if (crop.w <= 0 || crop.h <= 0) return;
    const cropAspect = crop.w / crop.h;
    if (cropAspect <= 0) return;
    const target = Number((widthMm / cropAspect).toFixed(2));
    if (Math.abs(target - heightMm) < 0.01) return;
    setHeightMm(target);
  }, [lockAspect, imageData, crop.w, crop.h, widthMm, heightMm]);

  // ── Pipeline: cells → quantise ─────────────────────────────────────
  // Debounced. Re-runs whenever crop, grid, K, or image change. Path
  // grouping happens downstream in ``previewState`` / ``buildRequest`` —
  // the pipeline itself stops at labels + centroids.
  useEffect(() => {
    if (!imageData) {
      setPipelineResult(null);
      return;
    }
    // Derive raster rows from the *crop* aspect, not the material —
    // when the aspect lock is off, the crop's own ratio is what
    // should drive the cell grid so a tall portrait crop doesn't
    // collapse to a wide raster.
    const cropAspect = crop.w > 0 && crop.h > 0 ? crop.w / crop.h : 1;
    const derivedRows = Math.max(1, Math.round(cellsAcross / cropAspect));
    let cancelled = false;
    // The crop drag fires at every pointer move; bump the debounce
    // so we're not running k-means on every frame. ``renderTick`` is
    // the controlled escape hatch — it triggers an immediate run.
    const wait = renderTick > 0 ? 0 : CROP_DEBOUNCE_MS;
    const handle = window.setTimeout(() => {
      try {
        const cells = sampleCellGrid(imageData, {
          cols: cellsAcross,
          rows: derivedRows,
          cropX: crop.x,
          cropY: crop.y,
          cropW: crop.w,
          cropH: crop.h,
        });
        const result = kMeansLab(cells, maxK);
        if (!cancelled) {
          setPipelineResult({
            labels: result.labels,
            centroidsHex: result.centroidsHex,
            cols: cellsAcross,
            rows: derivedRows,
            cellMeansHex: cells,
          });
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }, wait);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ``renderTick`` is intentionally an input
  }, [imageData, cellsAcross, maxK, crop, widthMm, heightMm, renderTick]);

  // Suppress the unused-name warning for the legacy debounce window —
  // kept around in case we want a "fast" lane back later.
  void DEBOUNCE_MS;

  // ── Derive layer rows from the pipeline result + matches ──────────
  const rows = useMemo<PixelArtLayerRow[]>(() => {
    if (!pipelineResult) return [];
    const counts = new Array(pipelineResult.centroidsHex.length).fill(0);
    let total = 0;
    for (const l of pipelineResult.labels) {
      if (l < 0) continue;
      counts[l]++;
      total++;
    }
    return pipelineResult.centroidsHex.map((color, i) => {
      const nearWhite = isNearWhite(color);
      // Default-disable near-white centroids on first encounter so
      // the user doesn't accidentally engrave the photo background.
      // ``enabledByColor`` is the user's explicit override and wins
      // when set — flipping a near-white back on stays on.
      const enabled = enabledByColor[color] ?? !nearWhite;
      const matched =
        matchByColor[color] ?? nearestPaletteEntry(color, paletteEntries);
      return {
        color,
        enabled,
        areaPct: total > 0 ? counts[i] / total : 0,
        cellCount: counts[i],
        isNearWhite: nearWhite,
        matchedEntry: matched,
        baseParams: defaultBaseParams(),
        materialId,
      };
    });
  }, [pipelineResult, enabledByColor, matchByColor, paletteEntries, materialId]);

  const previewState = useMemo<PreviewState | null>(() => {
    if (!pipelineResult) return null;
    const {
      labels, centroidsHex, cols, rows: pRows, cellMeansHex,
    } = pipelineResult;
    const enabledMap = new Map(rows.map((r) => [r.color, r.enabled]));

    // Per-cell centroid hex (or null for skipped). Disabled colours
    // get an 8-digit alpha hex so the on-screen canvas paint dims
    // them while the export path simply omits them.
    const cellCentroidHex: (string | null)[] = new Array(cols * pRows).fill(null);
    let enabledColorCount = 0;
    const seen = new Set<string>();
    for (let row = 0; row < pRows; row++) {
      for (let col = 0; col < cols; col++) {
        const label = labels[row * cols + col];
        if (label < 0) continue;
        const color = centroidsHex[label];
        const enabled = enabledMap.get(color) ?? true;
        cellCentroidHex[row * cols + col] = enabled
          ? color
          : `${color}55`;
        if (enabled && !seen.has(color)) {
          seen.add(color);
          enabledColorCount += 1;
        }
      }
    }

    return {
      cols,
      rows: pRows,
      cellCentroidHex,
      pathCount: enabledColorCount,
      kColors: centroidsHex.length,
      cellMeansHex,
    };
  }, [pipelineResult, rows]);

  // ── Handlers ────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onFile = useCallback(
    async (file: File) => {
      setError(undefined);
      try {
        const { bitmap, data } = await decodeFile(file);
        setImage(bitmap);
        setImageData(data);
        const cropInit = defaultCrop(bitmap.width, bitmap.height, widthMm, heightMm);
        setCrop(cropInit);
        // Photo-app exports routinely include commas / colons (e.g.
        // "ChatGPT Image May 1, 2026, 06:42:33 PM") that the backend
        // ``name`` pattern would 422 on — sanitiseProjectName lifts
        // the cleanup into one shared helper used by Loom + SVG
        // layers + here.
        const stem = sanitiseProjectName(file.name);
        if (stem) setName(stem);
        // Reset picks: a new image gets a fresh quantise + match flow.
        setEnabledByColor({});
        setMatchByColor({});
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [widthMm, heightMm],
  );

  const onMaterialChange = useCallback(
    (id: string) => {
      setMaterialId(id);
      const mat = library.materials.find((m) => String(m.id) === id);
      const { widthMm: w, heightMm: h } = materialDims(mat);
      setWidthMm(w);
      setHeightMm(h);
      // Re-clamp the crop to the new aspect.
      if (image) {
        setCrop(defaultCrop(image.width, image.height, w, h));
      }
    },
    [library.materials, image],
  );

  const onToggleLayer = useCallback((color: string, enabled: boolean) => {
    setEnabledByColor((prev) => ({ ...prev, [color]: enabled }));
  }, []);

  const onChooseMatch = useCallback(
    (color: string, entry: PaletteEntry | null) => {
      setMatchByColor((prev) => ({ ...prev, [color]: entry }));
    },
    [],
  );

  const onConfirmMerge = useCallback(
    (groups: MergeGroup[]) => {
      if (groups.length === 0) return;
      // Heuristic: drop maxK by the number of merges so the next
      // ``kMeansLab`` pass produces fewer centroids. The result tracks
      // user intent in aggregate (fewer colours) rather than honouring
      // the specific merge groupings — see PR #50 for the v1 trade-off.
      const reduction = groups.reduce(
        (n, g) => n + (g.sourceColors.length - 1),
        0,
      );
      setMaxK((k) => Math.max(2, k - reduction));
    },
    [],
  );

  const onRematchAll = useCallback(() => {
    if (paletteEntries.length === 0) return;
    setMatchByColor((prev) => {
      const next: Record<string, PaletteEntry | null> = { ...prev };
      for (const r of rows) {
        next[r.color] = nearestPaletteEntry(r.color, paletteEntries);
      }
      return next;
    });
  }, [paletteEntries, rows]);

  // ── Download builders ───────────────────────────────────────────────
  const buildRequest = useCallback((): PixelArtRequest | null => {
    if (!pipelineResult || !materialId) return null;
    const cellMm = widthMm / cellsAcross;
    const enabledColors = new Set(rows.filter((r) => r.enabled).map((r) => r.color));
    const { labels, centroidsHex, cols, rows: pRows } = pipelineResult;
    // One PixelArtRectSpec per cell (not merged). The backend groups
    // them by colour and emits one Path per layer.
    const rects: PixelArtRectSpec[] = [];
    for (let row = 0; row < pRows; row++) {
      for (let col = 0; col < cols; col++) {
        const label = labels[row * cols + col];
        if (label < 0) continue;
        const color = centroidsHex[label];
        if (!enabledColors.has(color)) continue;
        rects.push({
          x: col * cellMm,
          y: row * cellMm,
          width: cellMm,
          height: cellMm,
          color,
        });
      }
    }
    const layers: PixelArtLayerSpec[] = rows.map((row) => ({
      color: row.color,
      enabled: row.enabled,
      base_params: row.baseParams,
      material_id: row.materialId,
      palette_entry_id: row.matchedEntry?.id ?? null,
    }));
    return {
      name: name || "pixel-art",
      material_id: materialId,
      width_mm: widthMm,
      height_mm: heightMm,
      start_x: startX,
      start_y: startY,
      cell_mm: cellMm,
      rects,
      layers,
    };
  }, [pipelineResult, materialId, name, widthMm, heightMm, startX, startY, cellsAcross, rows]);

  const onDownloadXcs = useCallback(async () => {
    const req = buildRequest();
    if (!req) return;
    setGenerating(true);
    setError(undefined);
    try {
      await pixelArtAndDownload(req);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [buildRequest]);

  const onDownloadSvg = useCallback(async () => {
    const req = buildRequest();
    if (!req) return;
    setGenerating(true);
    setError(undefined);
    try {
      await pixelArtSvgAndDownload(req);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [buildRequest]);

  // Cell mm <-> cellsAcross dual control.
  const cellMm = widthMm > 0 ? widthMm / cellsAcross : 0;

  return (
    <div
      className="relative flex flex-col"
      // The TopBar is 56 px (h-14). Subtract it so the page sizes
      // exactly to the available viewport — no scrollbar, no wasted
      // strip below. The matching pb-3 / pt-3 inside the container
      // gives the same breathing room top + bottom.
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />

        {error && (
          <div className="mb-3 shrink-0 rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
            {error}
          </div>
        )}

        <div
          className="grid grid-cols-[260px_minmax(0,1fr)_320px] gap-4 items-stretch flex-1 min-h-0"
        >
          {/* ── Settings (left) ────────────────────────────────────── */}
          <div className="flex flex-col min-h-0 overflow-y-auto pr-1">
            <Card padded={false} className="p-4 flex flex-col gap-3">
              <Section title="Project" dense>
                <Field label="Output name">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
              </Section>

              <Section title="Material" dense>
                <Field label="Material">
                  <Select
                    value={materialId ?? ""}
                    onChange={(e) => onMaterialChange(e.target.value)}
                    disabled={library.materials.length === 0}
                  >
                    {library.materials.length === 0 && (
                      <option value="">No materials</option>
                    )}
                    {library.materials.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Width (mm)"
                    value={widthMm}
                    min={1}
                    onChange={setWidthMm}
                  />
                  <NumberField
                    label="Height (mm)"
                    value={heightMm}
                    min={1}
                    onChange={setHeightMm}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Start X (mm)"
                    value={startX}
                    onChange={setStartX}
                  />
                  <NumberField
                    label="Start Y (mm)"
                    value={startY}
                    onChange={setStartY}
                  />
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[color:var(--color-ink-muted)] mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lockAspect}
                    onChange={(e) => setLockAspect(e.target.checked)}
                  />
                  <span>
                    Lock crop to material aspect
                    <span className="block text-[10.5px] text-[color:var(--color-ink-subtle)]">
                      Off = burn fits the chosen crop. On = crop snaps to W/H.
                    </span>
                  </span>
                </label>
              </Section>

              <Section title="Grid" dense
                description="Cell count across the wide axis. Smaller cells give more detail but cost more rects."
              >
                <Field label={`Cells across · ${cellsAcross}`}>
                  <input
                    type="range"
                    min={8}
                    max={cellsAcrossMax}
                    step={1}
                    value={cellsAcross}
                    onChange={(e) => setCellsAcross(parseInt(e.target.value, 10))}
                    className="w-full accent-[color:var(--color-primary)]"
                  />
                </Field>
                <NumberField
                  label="Cell (mm)"
                  value={Number(cellMm.toFixed(3))}
                  min={2 * laserSpotMm}
                  step={0.1}
                  onChange={(v) => {
                    if (v <= 0 || widthMm <= 0) return;
                    const next = Math.max(8, Math.round(widthMm / v));
                    setCellsAcross(Math.min(cellsAcrossMax, next));
                  }}
                  hint={`Laser spot: ${laserSpotMm.toFixed(3)} mm`}
                />
              </Section>

              <Section title="Quantisation" dense
                description="Upper bound on colours. Fewer = simpler engrave; each colour becomes one compound path on export."
              >
                <Field label={`Max K · ${maxK}`}>
                  <input
                    type="range"
                    min={2}
                    max={32}
                    step={1}
                    value={maxK}
                    onChange={(e) => setMaxK(parseInt(e.target.value, 10))}
                    className="w-full accent-[color:var(--color-primary)]"
                  />
                </Field>
              </Section>

              <PixelArtStats
                rows={rows}
                cols={pipelineResult?.cols ?? 0}
                rasterRows={pipelineResult?.rows ?? 0}
              />
            </Card>
          </div>

          {/* ── Canvas (centre) ────────────────────────────────────── */}
          <div className="min-w-0 min-h-0 flex">
            <Card
              padded={false}
              className={cn("p-3 flex-1 min-h-0 flex flex-col")}
            >
              <PixelArtCanvas
                image={image}
                materialWidthMm={widthMm}
                materialHeightMm={heightMm}
                crop={crop}
                onCropChange={setCrop}
                preview={previewState}
                previewMode={previewMode}
                onPreviewModeChange={setPreviewMode}
                lockAspect={lockAspect}
                cropEnabled={cropEnabled}
                onCropEnabledChange={setCropEnabled}
                onUpload={() => fileInputRef.current?.click()}
                onReRender={() => setRenderTick((t) => t + 1)}
                canReRender={!!imageData}
              />
            </Card>
          </div>

          {/* ── Layer panel (right) ────────────────────────────────── */}
          <div className="flex flex-col min-h-0">
            <Card padded={false} className="p-3 flex-1 min-h-0 flex flex-col">
              <PixelArtLayerPanel
                rows={rows}
                paletteEntries={paletteEntries}
                library={library}
                onToggle={onToggleLayer}
                onChooseMatch={onChooseMatch}
                onConfirmMerge={onConfirmMerge}
                onRematchAll={onRematchAll}
                onDownloadXcs={onDownloadXcs}
                onDownloadSvg={onDownloadSvg}
                generating={generating}
              />
            </Card>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}

/* Mirrors the svg-layers section title's "Layers (N · M shapes ·
 * K verts)" surface, broken out into a standalone block on the left
 * sidebar so the user can read it without scanning the per-colour
 * cards on the right. The numbers reflect the *export* — i.e. only
 * enabled centroids contribute to layers / shapes / vertices, since
 * disabled colours are skipped at download time. The grid total is
 * separate so a glance tells the user "this many laser shapes
 * (enabled) out of this many positions (whole grid)". */
function PixelArtStats({
  rows,
  cols,
  rasterRows,
}: {
  rows: PixelArtLayerRow[];
  /** Pipeline grid columns (cells across). 0 before the first
   *  pipeline run. */
  cols: number;
  /** Pipeline grid rows. Renamed locally to avoid colliding with
   *  the ``rows`` prop above. */
  rasterRows: number;
}) {
  const layerCount = rows.filter((r) => r.enabled).length;
  const enabledCellCount = rows
    .filter((r) => r.enabled)
    .reduce((n, r) => n + r.cellCount, 0);
  // Each enabled cell exports as one rect path = 4 vertices. Closing
  // back to the start point isn't counted (svg-layers doesn't either).
  const vertexCount = enabledCellCount * 4;
  const totalGridCells = cols * rasterRows;
  const skippedCells = Math.max(0, totalGridCells - enabledCellCount);
  return (
    <Section title="Stats" dense>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 font-mono text-[11px] tabular-nums">
        <Stat label="Layers" value={layerCount.toLocaleString()} />
        <Stat
          label="Shapes"
          value={enabledCellCount.toLocaleString()}
          hint={`one rect per enabled cell (${enabledCellCount === 1 ? "shape" : "shapes"})`}
        />
        <Stat
          label="Vertices"
          value={vertexCount.toLocaleString()}
          hint="rect paths × 4 corners"
        />
        <Stat
          label="Grid total"
          value={
            totalGridCells > 0
              ? `${cols.toLocaleString()} × ${rasterRows.toLocaleString()} = ${totalGridCells.toLocaleString()}`
              : "—"
          }
          hint="cells across × down"
        />
        {skippedCells > 0 && (
          <Stat
            label="Skipped"
            value={skippedCells.toLocaleString()}
            hint="cells in disabled (e.g. near-white) layers"
          />
        )}
      </dl>
    </Section>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <>
      <dt
        className="text-[color:var(--color-ink-subtle)] font-semibold tracking-[0.06em] uppercase text-[10px] self-center"
        title={hint}
      >
        {label}
      </dt>
      <dd
        className="text-[color:var(--color-ink)] text-right self-center"
        title={hint}
      >
        {value}
      </dd>
    </>
  );
}
