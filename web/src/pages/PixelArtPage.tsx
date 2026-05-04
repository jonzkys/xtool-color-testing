/**
 * Pixel Art — quantise an image into a small grid of colour cells, run
 * a greedy rect-cover, and burn each colour as one engrave layer.
 *
 * This page composes three pieces:
 *   - left:   settings (name, material, start, grid, max-K)
 *   - center: ``PixelArtCanvas`` (original + crop on top, preview below)
 *   - right:  ``PixelArtLayerPanel`` (colour rows + actions)
 *
 * The pipeline (sample → quantise → cover → cap-fit) runs on every
 * change to ``crop`` / ``cellsAcross`` / ``maxK`` / ``imageData`` with
 * a small debounce. ``capFit`` returns the labels + rects + the
 * final K used; the page derives ``rows`` (one per centroid) from
 * those plus the auto-matched palette entries.
 *
 * Skip-engrave is enforced at download time, not in the preview — the
 * preview keeps showing the dimmed cell so the user can see the
 * background hole.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  Button,
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
  capFit,
  type CapFitResult,
} from "../components/pixelArtMath";
import { sampleCellGrid } from "../components/pixelArtImage";
import { defaultBaseParams } from "../defaults";
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

const RECT_CAP = 750;
const DEFAULT_CELLS_ACROSS = 32;
const DEFAULT_MAX_K = 8;
const DEBOUNCE_MS = 60;

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
  const [pipelineResult, setPipelineResult] = useState<CapFitResult | null>(null);
  const [enabledByColor, setEnabledByColor] = useState<Record<string, boolean>>({});
  const [matchByColor, setMatchByColor] = useState<Record<string, PaletteEntry | null>>({});
  const [error, setError] = useState<string | undefined>();
  const [generating, setGenerating] = useState(false);

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

  // ── Pipeline: cells → quantise → cover → cap-fit ───────────────────
  // Debounced. Re-runs whenever crop, grid, K, or image change.
  useEffect(() => {
    if (!imageData) {
      setPipelineResult(null);
      return;
    }
    const aspect = widthMm > 0 && heightMm > 0 ? widthMm / heightMm : 1;
    const derivedRows = Math.max(1, Math.round(cellsAcross / aspect));
    let cancelled = false;
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
        const result = capFit(cells, cellsAcross, derivedRows, maxK, RECT_CAP);
        if (!cancelled) setPipelineResult(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [imageData, cellsAcross, maxK, crop, widthMm, heightMm]);

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
      const enabled = enabledByColor[color] ?? true;
      const matched =
        matchByColor[color] ?? nearestPaletteEntry(color, paletteEntries);
      return {
        color,
        enabled,
        areaPct: total > 0 ? counts[i] / total : 0,
        matchedEntry: matched,
        baseParams: defaultBaseParams(),
        materialId,
      };
    });
  }, [pipelineResult, enabledByColor, matchByColor, paletteEntries, materialId]);

  const previewState = useMemo<PreviewState | null>(() => {
    if (!pipelineResult) return null;
    const aspect = widthMm > 0 && heightMm > 0 ? widthMm / heightMm : 1;
    const derivedRows = Math.max(1, Math.round(cellsAcross / aspect));
    const enabledMap = new Map(rows.map((r) => [r.color, r.enabled]));
    const rects = pipelineResult.rects.map((r) => {
      const color = pipelineResult.centroidsHex[r.label] ?? "#000000";
      const enabled = enabledMap.get(color) ?? true;
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        // Disabled colours render at half alpha so the user can still
        // see what they're skipping. The download path skips them.
        color: enabled ? color : `${color}55`,
      };
    });
    return {
      cols: cellsAcross,
      rows: derivedRows,
      rects,
      rectCount: pipelineResult.rects.length,
      kColors: pipelineResult.k,
    };
  }, [pipelineResult, rows, cellsAcross, widthMm, heightMm]);

  const capExceeded =
    !!pipelineResult &&
    pipelineResult.rects.length > RECT_CAP &&
    !pipelineResult.exceededAtK2;
  const hardCapExceeded = !!pipelineResult && pipelineResult.exceededAtK2;

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
        const stem = file.name.replace(/\.[^.]+$/, "").trim();
        if (stem) setName(stem.slice(0, 64));
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
      // Merge centroids in-place: pick the representative as the
      // canonical hex, drop the others. The pipeline doesn't re-run; we
      // just rewrite ``matchByColor`` and ``enabledByColor`` so the
      // representative takes the union state, then the next preview
      // tick can use the new mapping.
      // Simpler approach: nudge ``maxK`` down by ``groups.length - X``
      // so capFit re-runs with fewer centroids. This always converges
      // toward the user's intent (fewer colours).
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

  const onAutoFitToCap = useCallback(() => {
    if (!pipelineResult) return;
    setMaxK(pipelineResult.k);
  }, [pipelineResult]);

  // ── Download builders ───────────────────────────────────────────────
  const buildRequest = useCallback((): PixelArtRequest | null => {
    if (!pipelineResult || !materialId) return null;
    const cellMm = widthMm / cellsAcross;
    const enabledColors = new Set(rows.filter((r) => r.enabled).map((r) => r.color));
    const rects: PixelArtRectSpec[] = pipelineResult.rects
      .map((r) => {
        const color = pipelineResult.centroidsHex[r.label];
        return { r, color };
      })
      .filter(({ color }) => enabledColors.has(color))
      .map(({ r, color }) => ({
        x: r.x * cellMm,
        y: r.y * cellMm,
        width: r.width * cellMm,
        height: r.height * cellMm,
        color,
      }));
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
    <div className="relative min-h-full">
      {/* Diagonal warp backdrop — quiet, always-on brand motif. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--color-ink) 0 1px, transparent 1px 24px)",
        }}
      />
      <PageContainer maxWidth="wide" className="relative py-8">
        <header className="mb-6">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <div className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
                Workshop · raster
              </div>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-[color:var(--color-ink)]">
                Pixel art
              </h1>
              <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[60ch]">
                Quantise an image to K colours, run a greedy rect-cover
                so the engrave is a handful of fills (not thousands of
                pixels), and burn each colour with its matched palette
                params.
              </p>
            </div>
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
            <Button
              variant="primary"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {image ? "Replace image" : "Upload image"}
            </Button>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-[260px_minmax(0,1fr)_340px] gap-5 items-start">
          {/* ── Settings (left) ────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
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
                description="Upper bound on colours. Fewer = simpler engrave; capFit drops K automatically if the rect cap is exceeded."
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
            </Card>
          </div>

          {/* ── Canvas (centre) ────────────────────────────────────── */}
          <div className="min-w-0">
            <Card padded={false} className={cn("p-4")}>
              <PixelArtCanvas
                image={image}
                materialWidthMm={widthMm}
                materialHeightMm={heightMm}
                crop={crop}
                onCropChange={setCrop}
                preview={previewState}
              />
            </Card>
          </div>

          {/* ── Layer panel (right) ────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            <Card padded={false} className="p-4">
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
                capExceeded={capExceeded}
                hardCapExceeded={hardCapExceeded}
                rectCount={pipelineResult?.rects.length ?? 0}
                onAutoFitToCap={onAutoFitToCap}
                generating={generating}
              />
            </Card>
          </div>
        </div>
      </PageContainer>
    </div>
  );
}
