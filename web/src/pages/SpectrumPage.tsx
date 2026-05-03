import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { SpectrumAbout } from "./SpectrumAbout";
import {
  alignPcaWithReference,
  deltaE76,
  evalPoly,
  hexToLab,
  labToHex,
  pca1,
  polyFit,
  predictXFromLab,
  type Lab,
  type PolyFit,
} from "../color/math";
import { listTests } from "../api/tests";
import { getCurrentMachineId } from "../state/machine";
import { getAveragedSwatches } from "../api/results";
import type { AveragedSwatch, SampleAggregator, TestRecord } from "../types";

/** Human-readable summary of the test's sampling shape + aggregator,
 *  e.g. "median · 50% inscribed circle". Mirrors the caption used in
 *  the result-detail dialog and the test editor so users see one
 *  consistent vocabulary across the app. */
function samplingDescription(
  cell_shape: string,
  aggregator: SampleAggregator | undefined,
): string {
  const labels: Record<SampleAggregator, string> = {
    median: "median",
    mean: "mean",
    saturation_median: "saturation-biased median",
    trimmed_mean: "trimmed mean (10%)",
    kmeans_dominant: "K-means dominant cluster",
  };
  const region =
    cell_shape === "circle" ? "50% inscribed circle" : "central rect";
  const agg = aggregator ?? "saturation_median";
  return `${labels[agg]} · ${region}`;
}
import {
  computeCellSpread,
  computeGridStability,
  type CellSpread,
} from "../color/variability";
import { StabilityChip } from "../components/StabilityChip";
import { PerCellExplodeStrip } from "../components/PerCellExplodeStrip";
import { SaveSpectrumDialog } from "../components/SaveSpectrumDialog";
import { useRoute } from "../router";
import {
  Badge,
  Button,
  cn,
  EmptyState,
  Field,
  MetalBar,
  PageContainer,
  Section,
  Select,
} from "../ui";

/* ---------- Projection axes -------------------------------------------- */

type Projection =
  | "pc1"
  | "lightness"
  | "chroma"
  | "hue"
  | "hue_raw"
  | "a"
  | "b"
  | "delta_e_first";

// Unit strings are plain ASCII so the y-axis label survives SVG rotation
// without font-fallback splitting subscript glyphs onto their own lines.
const PROJ_META: Record<
  Projection,
  { label: string; full: string; unit: string }
> = {
  pc1:           { label: "PC1",    full: "Principal component",      unit: "dLab" },
  lightness:     { label: "L*",     full: "Lightness",                unit: "L*"   },
  chroma:        { label: "C*",     full: "Chroma",                   unit: "C*"   },
  hue:           { label: "h°",     full: "Hue angle (unwrapped)",    unit: "deg"  },
  hue_raw:       { label: "h°raw",  full: "Hue angle (wrapped 0–360)", unit: "deg"  },
  a:             { label: "a*",     full: "Red ↔ green",              unit: "a*"   },
  b:             { label: "b*",     full: "Yellow ↔ blue",            unit: "b*"   },
  delta_e_first: { label: "dE0",    full: "ΔE from first",            unit: "dE76" },
};

function computeProjection(
  samples: { x: number; lab: Lab }[],
  proj: Projection,
): { y: number[]; unit: string; variance_ratio?: number } {
  const meta = PROJ_META[proj];
  if (samples.length === 0) return { y: [], unit: meta.unit };
  switch (proj) {
    case "lightness": return { y: samples.map((s) => s.lab[0]), unit: meta.unit };
    case "a":         return { y: samples.map((s) => s.lab[1]), unit: meta.unit };
    case "b":         return { y: samples.map((s) => s.lab[2]), unit: meta.unit };
    case "chroma":
      return {
        y: samples.map((s) => Math.hypot(s.lab[1], s.lab[2])),
        unit: meta.unit,
      };
    case "hue_raw": {
      // Wrapped 0–360 — honest polar angle in Lab, sawtooth jumps across the seam.
      return {
        y: samples.map(
          (s) => ((Math.atan2(s.lab[2], s.lab[1]) * 180) / Math.PI + 360) % 360,
        ),
        unit: meta.unit,
      };
    }
    case "hue": {
      // Unwrap hue so it reads monotonic across the 0°/360° seam.
      const raw = samples.map(
        (s) => ((Math.atan2(s.lab[2], s.lab[1]) * 180) / Math.PI + 360) % 360,
      );
      const unwrapped = [raw[0]];
      for (let i = 1; i < raw.length; i++) {
        let d = raw[i] - raw[i - 1];
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        unwrapped.push(unwrapped[i - 1] + d);
      }
      return { y: unwrapped, unit: meta.unit };
    }
    case "delta_e_first": {
      const first = samples[0].lab;
      return { y: samples.map((s) => deltaE76(first, s.lab)), unit: meta.unit };
    }
    case "pc1": {
      const raw = pca1(samples.map((s) => s.lab));
      const xs = samples.map((s) => s.x);
      const aligned = alignPcaWithReference(raw, xs);
      return {
        y: aligned.projected,
        unit: meta.unit,
        variance_ratio: aligned.variance_ratio,
      };
    }
  }
}

/* ---------- Page ------------------------------------------------------- */

export function SpectrumPage() {
  const [route, navigate] = useRoute();
  const routeId = route.name === "spectrum" ? route.id : undefined;

  const [tests, setTests] = useState<TestRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>(routeId);
  const [swatches, setSwatches] = useState<AveragedSwatch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Load tests — only single-axis ones make sense here.
  useEffect(() => {
    listTests({ status: "tested", machine_id: getCurrentMachineId() })
      .then((all) => {
        const mono = all.filter((t) => t.spec.y_param == null);
        setTests(mono);
        if (selectedId == null && mono.length > 0) {
          setSelectedId(mono[0].id);
        }
      })
      .catch((e) => setError((e as Error).message));
  }, []); // eslint-disable-line

  // Fetch swatches whenever the selection changes.
  useEffect(() => {
    if (selectedId == null) {
      setSwatches(null);
      return;
    }
    setLoading(true);
    setSwatches(null);
    setError(undefined);
    getAveragedSwatches(selectedId)
      .then((s) => setSwatches(s))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [selectedId]);

  // Keep the URL in sync with the selector so links survive reloads.
  useEffect(() => {
    if (
      selectedId != null &&
      (route.name !== "spectrum" || route.id !== selectedId)
    ) {
      navigate({ name: "spectrum", id: selectedId });
    }
  }, [selectedId]); // eslint-disable-line

  const selected = tests.find((t) => t.id === selectedId);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Variability state — lifted to the page level so the header's
  // Stability chip can broadcast "jump to first unstable cell" to the
  // body without any imperative ref choreography.
  const stability = useMemo(
    () => computeGridStability(swatches ?? []),
    [swatches],
  );
  const [pinnedX, setPinnedX] = useState<number | null>(null);
  useEffect(() => {
    setPinnedX(null);
  }, [selectedId]);
  const jumpToUnstable = () => {
    if (stability.unstableSwatches.length === 0) return;
    const first = stability.unstableSwatches[0];
    if (first.x_value != null) setPinnedX(first.x_value);
  };

  return (
    <PageContainer className="py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-1.5">
            <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
            Spectrum · experimental
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
              Parameter ↔ colour playground
            </h1>
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              aria-label="Open field manual — how this page works"
              className={cn(
                "group relative inline-flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-full",
                "border border-[color:var(--color-primary)]/40",
                "bg-[color:var(--color-primary-tint)]",
                "text-[color:var(--color-primary)]",
                "shadow-[0_1px_0_rgba(184,65,14,0.08),inset_0_0_0_1px_rgba(255,255,255,0.5)]",
                "hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
                "transition-colors",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full",
                  "bg-[color:var(--color-surface)] border border-[color:var(--color-primary)]/30",
                  "group-hover:bg-white/20 group-hover:border-white/40",
                  "transition-colors",
                )}
              >
                <BookOpen className="h-3 w-3" strokeWidth={2} />
              </span>
              <span className="font-mono text-[11px] font-semibold tracking-[0.14em] uppercase">
                Field manual
              </span>
              <span
                aria-hidden
                className="ml-0.5 font-mono text-[10px] tabular-nums opacity-60 group-hover:opacity-90"
              >
                ?
              </span>
            </button>
            {/* Companion link to the 2-axis playground. Shown unconditionally
                so users without 2-D tests yet still learn the page exists. */}
            <button
              type="button"
              onClick={() => navigate({ name: "spectrum-2d" })}
              className={cn(
                "inline-flex items-center h-8 px-3 rounded-full",
                "border border-[color:var(--color-border-strong)]",
                "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-muted)]",
                "hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-primary)]/50",
                "font-mono text-[11px] font-semibold tracking-[0.14em] uppercase",
                "transition-colors",
              )}
            >
              2-axis spectrum →
            </button>
            <StabilityChip stability={stability} onJumpToUnstable={jumpToUnstable} />
          </div>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)] max-w-[68ch]">
            Pick a single-axis test and explore how the swept parameter
            maps to a colour. Colours are projected onto a 1-D axis — try
            PC1 for the most informative projection of the actual spectrum,
            or L*/hue/chroma to isolate a single perceptual dimension.
          </p>
        </div>
        <div className="min-w-[260px]">
          <Field label="Test">
            <Select
              value={selectedId ?? ""}
              onChange={(e) =>
                setSelectedId(e.target.value ? Number(e.target.value) : undefined)
              }
            >
              {tests.length === 0 && <option value="">— no tested 1-axis tests —</option>}
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.id} · {t.name} ({t.spec.x_param})
                </option>
              ))}
            </Select>
          </Field>
          {selected && (
            <p className="mt-1.5 font-mono text-[10px] tracking-[0.06em] text-[color:var(--color-ink-subtle)]">
              Sampling ·{" "}
              <span className="text-[color:var(--color-ink-muted)]">
                {samplingDescription(
                  selected.spec.cell_shape,
                  selected.spec.sample_aggregator,
                )}
              </span>
              <span
                className="ml-1 text-[color:var(--color-ink-subtle)]"
                title="The averaged spectrum reflects each result's stored swatches. If you change the aggregator, reingest the affected results to refresh the average."
              >
                ⓘ
              </span>
            </p>
          )}
        </div>
      </header>

      <SpectrumAbout open={aboutOpen} onOpenChange={setAboutOpen} />

      {tests.length === 0 ? (
        <Section>
          <EmptyState
            title="No single-axis tests yet"
            description="Upload a photo of a tested 1-axis parameter sweep (on any material) and come back — this page will plot how its colours travel across the parameter range."
            action={
              <Button
                variant="primary"
                onClick={() => navigate({ name: "tests" })}
              >
                Open tests
              </Button>
            }
          />
        </Section>
      ) : loading || swatches == null ? (
        <Section>
          <div className="py-10 text-center font-mono text-[11px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)]">
            Loading swatches…
          </div>
        </Section>
      ) : error ? (
        <Section>
          <div className="rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-4 py-3 text-[13px] text-[color:var(--color-destructive)]">
            {error}
          </div>
        </Section>
      ) : (
        <SpectrumBody
          test={selected!}
          swatches={swatches}
          pinnedX={pinnedX}
          setPinnedX={setPinnedX}
        />
      )}
    </PageContainer>
  );
}

/* ---------- Body (loaded state) --------------------------------------- */

function SpectrumBody({
  test,
  swatches,
  pinnedX,
  setPinnedX,
}: {
  test: TestRecord;
  swatches: AveragedSwatch[];
  pinnedX: number | null;
  setPinnedX: (x: number | null) => void;
}) {
  // Sort by x_value so every downstream visualization stays ordered.
  // Also keep the source ``AveragedSwatch`` on each record so the strip
  // can render per-cell variability (ghost fans, envelope width)
  // without a second lookup by x.
  const fullSamples = useMemo(() => {
    return [...swatches]
      .filter((s) => s.x_value != null && s.lab?.length === 3)
      .sort((a, b) => a.x_value - b.x_value)
      .map((s) => ({
        x: s.x_value,
        hex: s.hex,
        lab: s.lab as Lab,
        swatch: s,
      }));
  }, [swatches]);

  const fullSpreads: CellSpread[] = useMemo(
    () => fullSamples.map((s) => computeCellSpread(s.swatch)),
    [fullSamples],
  );
  const anyReplicates = fullSpreads.some((sp) => sp.n >= 2);
  // Index of the pinned cell within ``fullSamples``, or -1 when no pin.
  const pinnedIdx = pinnedX == null
    ? -1
    : fullSamples.findIndex((s) => s.x === pinnedX);

  const fullXMin = fullSamples[0]?.x ?? 0;
  const fullXMax = fullSamples[fullSamples.length - 1]?.x ?? 0;

  // Clip controls — lets the user exclude the burn-in dead zones at the
  // low/high end of the sweep so they don't skew PC1 / fits / oracle.
  // Reset whenever the underlying test changes (identity of fullSamples).
  const [rangeStart, setRangeStart] = useState(fullXMin);
  const [rangeEnd, setRangeEnd] = useState(fullXMax);
  useEffect(() => {
    setRangeStart(fullXMin);
    setRangeEnd(fullXMax);
  }, [fullXMin, fullXMax]);

  // Every downstream analysis runs on the clipped subset.
  const samples = useMemo(
    () => fullSamples.filter((s) => s.x >= rangeStart && s.x <= rangeEnd),
    [fullSamples, rangeStart, rangeEnd],
  );

  const clipped = samples.length !== fullSamples.length;

  const [projection, setProjection] = useState<Projection>("pc1");
  const [fitDegree, setFitDegree] = useState<0 | 1 | 2 | 3>(2);
  const [oracleHex, setOracleHex] = useState<string>("");
  // "Crop" hides the excluded regions and renders the strips at full
  // width across the active range only. Auto-disabled when the range
  // covers the full sweep (nothing to crop).
  const [cropped, setCropped] = useState(false);
  useEffect(() => {
    if (!clipped && cropped) setCropped(false);
  }, [clipped, cropped]);

  const proj = useMemo(
    () => computeProjection(samples, projection),
    [samples, projection],
  );

  const xs = samples.map((s) => s.x);
  const ys = proj.y;
  const fit = useMemo<PolyFit | null>(() => {
    if (fitDegree === 0 || xs.length < fitDegree + 2) return null;
    return polyFit(xs, ys, fitDegree);
  }, [xs, ys, fitDegree]);

  // Modeled spectrum — independent of the projection choice. We fit each
  // Lab channel separately against x and reconstruct predicted colours
  // across the full sweep, so the user can compare actual-vs-model
  // colour-for-colour at every parameter value.
  const modeled = useMemo(() => {
    if (fitDegree === 0 || samples.length < fitDegree + 2) return null;
    const Ls = samples.map((s) => s.lab[0]);
    const As = samples.map((s) => s.lab[1]);
    const Bs = samples.map((s) => s.lab[2]);
    const xsClipped = samples.map((s) => s.x);
    const fitL = polyFit(xsClipped, Ls, fitDegree);
    const fitA = polyFit(xsClipped, As, fitDegree);
    const fitB = polyFit(xsClipped, Bs, fitDegree);
    // Dense sample across the full parameter range so the strip lines
    // up with the sampled strip above. Extrapolated regions are visually
    // flagged by the "fit boundary" markers rather than hidden.
    const steps = 240;
    const strip: { x: number; hex: string }[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const x = fullXMin + t * (fullXMax - fullXMin);
      const L = evalPoly(fitL.coeffs, x);
      const A = evalPoly(fitA.coeffs, x);
      const B = evalPoly(fitB.coeffs, x);
      strip.push({ x, hex: labToHex([L, A, B]) });
    }
    // Per-sample residual ΔE76 averaged over the clipped training set —
    // a single "typical colour error" number in perceptual units.
    let totalDelta = 0;
    let worstDelta = 0;
    for (const s of samples) {
      const predLab: Lab = [
        evalPoly(fitL.coeffs, s.x),
        evalPoly(fitA.coeffs, s.x),
        evalPoly(fitB.coeffs, s.x),
      ];
      const d = deltaE76(s.lab, predLab);
      totalDelta += d;
      if (d > worstDelta) worstDelta = d;
    }
    return {
      strip,
      meanResidualDeltaE: totalDelta / samples.length,
      worstResidualDeltaE: worstDelta,
      perChannelR2: [fitL.r2, fitA.r2, fitB.r2] as const,
      fitL,
      fitA,
      fitB,
    };
  }, [samples, fitDegree, fullXMin, fullXMax]);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const canSave = useMemo(() => {
    // Disable when nothing's worth saving:
    // - full-range crop (nothing was filtered out),
    // - degree 0 (no equation),
    // - under-determined fit (need >= degree+1 points).
    if (!clipped) return false;
    if (fitDegree === 0) return false;
    if (samples.length < fitDegree + 1) return false;
    if (modeled === null) return false;
    return true;
  }, [clipped, fitDegree, samples.length, modeled]);

  // Step ΔE between consecutive swatches (of the clipped set).
  const stepDeltas = useMemo(() => {
    const out: { i: number; x1: number; x2: number; dE: number; hex1: string; hex2: string }[] = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      out.push({
        i,
        x1: a.x,
        x2: b.x,
        dE: deltaE76(a.lab, b.lab),
        hex1: a.hex,
        hex2: b.hex,
      });
    }
    return out;
  }, [samples]);

  // Color oracle prediction (searches only within the active range).
  const oracle = useMemo(() => {
    const hex = oracleHex.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) return null;
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    const target = hexToLab(normalized);
    const r = predictXFromLab(samples, target);
    if (!r) return null;
    return {
      hex: normalized,
      predictedX: r.x,
      deltaE: r.bestDeltaE,
      nearestHex: samples[r.bestIndex].hex,
    };
  }, [oracleHex, samples]);

  if (fullSamples.length < 2) {
    return (
      <Section>
        <EmptyState
          title="Not enough swatches to plot"
          description="This test is tested but has no (or only one) sampled cell. Try another test."
        />
      </Section>
    );
  }

  // Clamp range updates so we always keep at least 2 samples inside.
  const applyRange = (startRaw: number, endRaw: number) => {
    const step = fullSamples[1].x - fullSamples[0].x; // typical step size
    const tiny = Math.abs(step) * 0.1 || 1e-6;
    let start = Math.max(fullXMin, Math.min(startRaw, fullXMax - tiny));
    let end = Math.min(fullXMax, Math.max(endRaw, fullXMin + tiny));
    if (end - start < tiny) {
      // If they cross, lock to a minimum window.
      end = Math.min(fullXMax, start + tiny);
    }
    setRangeStart(start);
    setRangeEnd(end);
  };
  const resetRange = () => {
    setRangeStart(fullXMin);
    setRangeEnd(fullXMax);
    setCropped(false);
  };

  const xMin = samples.length > 0 ? samples[0].x : rangeStart;
  const xMax = samples.length > 0 ? samples[samples.length - 1].x : rangeEnd;

  return (
    <div className="space-y-6">
      {/* Test summary card */}
      <SummaryBar test={test} samples={samples} proj={proj} projection={projection} />

      {/* Hero: the literal "colour on a linear axis" — spectrum strip. */}
      <Section
        title="Spectrum strip"
        dense
        actions={
          <RangeControls
            xParam={test.spec.x_param}
            fullXMin={fullXMin}
            fullXMax={fullXMax}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onChange={applyRange}
            onReset={resetRange}
            clipped={clipped}
            cropped={cropped}
            onToggleCrop={() => setCropped((c) => !c)}
            activeCount={samples.length}
            totalCount={fullSamples.length}
          />
        }
      >
        <StripLabel text="Sampled" hint="what the photo actually captured" />
        <SpectrumStrip
          fullSamples={fullSamples}
          fullSpreads={fullSpreads}
          fullXMin={fullXMin}
          fullXMax={fullXMax}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onRangeChange={applyRange}
          cropped={cropped && clipped}
          variabilityOn={anyReplicates}
          pinnedIdx={pinnedIdx}
          onPinCell={(i) => {
            if (i == null) {
              setPinnedX(null);
            } else {
              setPinnedX(fullSamples[i]?.x ?? null);
            }
          }}
        />
        {pinnedIdx >= 0 && fullSpreads[pinnedIdx]?.n >= 2 && (
          <PerCellExplodeStrip
            label={`${PROJ_META[projection].label} @ ${String(test.spec.x_param)} = ${fmtNum(fullSamples[pinnedIdx].x)}`}
            cell={fullSamples[pinnedIdx].swatch}
            onClose={() => setPinnedX(null)}
          />
        )}

        {modeled && (
          <div className="mt-3">
            <StripLabel
              text={`Modeled · deg ${fitDegree}`}
              hint="polynomial prediction, per-channel L*/a*/b* fit → Lab → hex"
              meta={
                <>
                  <MetaChip
                    label="Residual"
                    value={`ΔE ${modeled.meanResidualDeltaE.toFixed(2)}`}
                    tone={
                      modeled.meanResidualDeltaE < 1.5
                        ? "good"
                        : modeled.meanResidualDeltaE < 4
                          ? "warn"
                          : "bad"
                    }
                    hint="average colour error between each actual swatch and its modeled prediction"
                  />
                  <MetaChip
                    label="Worst"
                    value={`ΔE ${modeled.worstResidualDeltaE.toFixed(2)}`}
                    hint="single worst-predicted swatch's ΔE"
                  />
                </>
              }
            />
            <ModeledStrip
              strip={modeled.strip}
              fullXMin={fullXMin}
              fullXMax={fullXMax}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              cropped={cropped && clipped}
            />
            <p className="mt-2 font-mono text-[10.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
              Each Lab channel gets its own degree-{fitDegree} fit against{" "}
              {test.spec.x_param}; the three fits reconstruct the predicted
              colour at every point.{" "}
              {cropped && clipped
                ? "Cropped to the active range — extrapolation hidden."
                : "Extrapolation outside the active range (hatched band) is shown so you can see where the model would send the dead zones."}
            </p>
          </div>
        )}

        {samples.length < 2 && (
          <div className="mt-3 rounded-[8px] border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-tint)] px-4 py-2 font-mono text-[11px] text-[color:var(--color-ink-muted)]">
            Fewer than 2 samples inside the active range — widen it to see
            the plot, fit, and oracle.
          </div>
        )}
      </Section>

      {/* Scatter plot with projection + fit controls. */}
      <Section
        title="Projection plot"
        dense
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <ProjectionChips value={projection} onChange={setProjection} />
          </div>
        }
      >
        {samples.length >= 2 ? (
          <div className="grid md:grid-cols-[1fr_240px] gap-4 items-start">
            <PlotSvg
              samples={samples}
              ys={ys}
              xLabel={test.spec.x_param}
              yLabel={proj.unit}
              fit={fit}
            />
            <FitPanel
              fitDegree={fitDegree}
              onChangeDegree={setFitDegree}
              fit={fit}
              xParam={test.spec.x_param}
              yUnit={proj.unit}
              proj={proj}
              projection={projection}
              canSave={canSave}
              onSave={() => setSaveDialogOpen(true)}
            />
          </div>
        ) : (
          <PlotPlaceholder />
        )}
      </Section>

      {/* Step ΔE panel. */}
      <Section
        title="Step ΔE"
        dense
        actions={
          <span className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
            per-step colour change
          </span>
        }
      >
        {samples.length >= 2 ? (
          <StepDeltaChart steps={stepDeltas} xMin={xMin} xMax={xMax} />
        ) : (
          <PlotPlaceholder />
        )}
      </Section>

      {/* Colour oracle. */}
      <Section
        title="Colour oracle"
        dense
        actions={
          <span className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
            inverse lookup · experimental
          </span>
        }
      >
        <Oracle
          hex={oracleHex}
          onHexChange={setOracleHex}
          oracle={oracle}
          xParam={test.spec.x_param}
        />
      </Section>
      {modeled !== null && (
        <SaveSpectrumDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          onSaved={() => { /* future: emit a toast or refresh */ }}
          testName={test.name}
          testId={test.id}
          axisParam={test.spec.x_param}
          axisMin={rangeStart}
          axisMax={rangeEnd}
          swatches={samples.map((s) => ({
            swatch_row: s.swatch.row,
            swatch_col: s.swatch.col,
            x_value: s.x,
            hex: s.hex,
            lab: [s.lab[0], s.lab[1], s.lab[2]] as [number, number, number],
          }))}
          fitDegree={fitDegree as 1 | 2 | 3}
          fitCoefficients={{
            l: modeled.fitL.coeffs,
            a: modeled.fitA.coeffs,
            b: modeled.fitB.coeffs,
          }}
          fitR2={{
            l: modeled.perChannelR2[0],
            a: modeled.perChannelR2[1],
            b: modeled.perChannelR2[2],
          }}
          displayedProjection={projection}
        />
      )}
    </div>
  );
}

/* ---------- Summary bar ------------------------------------------------ */

function SummaryBar({
  test,
  samples,
  proj,
  projection,
}: {
  test: TestRecord;
  samples: { x: number; hex: string; lab: Lab }[];
  proj: ReturnType<typeof computeProjection>;
  projection: Projection;
}) {
  // Linearity score: r² of a simple linear fit against the current projection.
  const linearR2 = useMemo(() => {
    if (samples.length < 3 || proj.y.length !== samples.length) return null;
    const f = polyFit(
      samples.map((s) => s.x),
      proj.y,
      1,
    );
    return f.r2;
  }, [samples, proj.y]);

  const x0 = samples[0].x;
  const x1 = samples[samples.length - 1].x;

  return (
    <div className="rounded-[12px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-5 py-3.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-[10.5px] font-semibold tracking-[0.16em] text-[color:var(--color-ink-subtle)]">
          #{test.id}
        </span>
        <span className="text-[14.5px] font-semibold text-[color:var(--color-ink)]">
          {test.name}
        </span>
        <Badge variant="info" size="sm">
          {test.spec.x_param}
        </Badge>
        <span className="font-mono text-[11px] text-[color:var(--color-ink-muted)]">
          {fmtNum(x0)} → {fmtNum(x1)} × {samples.length}
        </span>
      </div>
      <MetalBar variant="soft" />
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[color:var(--color-border)]">
        <MiniStat
          label="Samples"
          value={String(samples.length)}
        />
        <MiniStat
          label="Mean ΔE-step"
          value={
            samples.length > 1
              ? (() => {
                  let s = 0;
                  for (let i = 1; i < samples.length; i++) {
                    s += deltaE76(samples[i - 1].lab, samples[i].lab);
                  }
                  return (s / (samples.length - 1)).toFixed(1);
                })()
              : "—"
          }
        />
        <MiniStat
          label="PC1 variance"
          value={
            projection === "pc1" && proj.variance_ratio != null
              ? `${(proj.variance_ratio * 100).toFixed(1)}%`
              : (() => {
                  const raw = pca1(samples.map((s) => s.lab));
                  return `${(raw.variance_ratio * 100).toFixed(1)}%`;
                })()
          }
          hint="how much of the spectrum's Lab variance PC1 captures — high = nearly-1D colour path"
        />
        <MiniStat
          label="Linearity"
          value={linearR2 == null ? "—" : `r² ${linearR2.toFixed(3)}`}
          hint={`r² of a linear ${PROJ_META[projection].full.toLowerCase()} vs ${test.spec.x_param} fit`}
        />
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="px-4 py-3" title={hint}>
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14.5px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </div>
    </div>
  );
}

/* ---------- Spectrum strip (the hero) ---------------------------------- */

function SpectrumStrip({
  fullSamples,
  fullSpreads,
  fullXMin,
  fullXMax,
  rangeStart,
  rangeEnd,
  onRangeChange,
  cropped,
  variabilityOn,
  pinnedIdx,
  onPinCell,
}: {
  fullSamples: { x: number; hex: string; lab: Lab }[];
  /** Optional, index-aligned with ``fullSamples``. When provided, the
   *  strip overlays a ΔE envelope + per-cell ghost fans. Pass
   *  ``undefined`` for pages that don't have replicate data (e.g.
   *  the modeled strip). */
  fullSpreads?: CellSpread[];
  fullXMin: number;
  fullXMax: number;
  rangeStart: number;
  rangeEnd: number;
  onRangeChange: (start: number, end: number) => void;
  cropped: boolean;
  /** Master toggle for the variability overlays. False → strip renders
   *  identically to its pre-variability look. */
  variabilityOn?: boolean;
  /** Index into ``fullSamples`` of the pinned cell, or -1. */
  pinnedIdx?: number;
  /** Click a cell → pin (or unpin when clicking the pinned cell). */
  onPinCell?: (i: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  // When cropped, the strip spans rangeStart..rangeEnd at full width; the
  // overlays / brackets / handles collapse to the edges and hide.
  const stripXMin = cropped ? rangeStart : fullXMin;
  const stripXMax = cropped ? rangeEnd : fullXMax;
  // Align spreads with the (possibly cropped) visible samples so indices
  // into ``stripSamples`` line up with spread metadata.
  const visibleIdx = cropped
    ? fullSamples.reduce<number[]>((acc, s, i) => {
        if (s.x >= rangeStart && s.x <= rangeEnd) acc.push(i);
        return acc;
      }, [])
    : fullSamples.map((_, i) => i);
  const stripSamples = visibleIdx.map((i) => fullSamples[i]);
  const stripSpreads = fullSpreads
    ? visibleIdx.map((i) => fullSpreads[i])
    : undefined;
  const showVariability =
    !!variabilityOn && !!stripSpreads && stripSpreads.some((sp) => sp.n >= 2);
  // Ghost fans are dense, so auto-hide above 40 cells; user can still
  // hover a cell to reveal its fan (we always render the hover state).
  const ghostAlwaysOn = stripSamples.length <= 40;
  // Max spread across visible cells drives the envelope's vertical scale.
  const maxVisibleSpread = stripSpreads
    ? stripSpreads.reduce((m, sp) => Math.max(m, sp.maxSpread), 0)
    : 0;

  // Fraction of the strip width occupied by a given x-value (in the
  // current strip's coordinate space).
  const t = (x: number) => {
    const range = stripXMax - stripXMin || 1;
    return (x - stripXMin) / range;
  };
  const startT = t(rangeStart);
  const endT = t(rangeEnd);

  // Drag a handle. Listens globally while the mouse is down. Drag space
  // is always the full sweep so the handles can move beyond the current
  // strip width (even when not cropped). When cropped the handles are
  // hidden so this effectively no-ops.
  useEffect(() => {
    if (!dragging) return;
    const pickX = (clientX: number) => {
      const rect = stripRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return stripXMin + frac * (stripXMax - stripXMin);
    };
    const onMove = (e: MouseEvent) => {
      const x = pickX(e.clientX);
      if (x == null) return;
      if (dragging === "start") onRangeChange(x, rangeEnd);
      else onRangeChange(rangeStart, x);
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, stripXMin, stripXMax, rangeStart, rangeEnd, onRangeChange]);

  const hovered = hover != null ? stripSamples[hover] : null;

  return (
    <div>
      <div
        ref={stripRef}
        className="relative rounded-[8px] overflow-hidden border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] select-none"
        style={{ height: 68 }}
      >
        {/* Colour cells — every sample rendered; when cropped the strip
            is already filtered to the active range. */}
        <div className="absolute inset-0 flex">
          {stripSamples.map((s, i) => {
            const fullI = visibleIdx[i];
            const spread = stripSpreads?.[i];
            const isPinned = pinnedIdx === fullI;
            const showFan =
              showVariability &&
              spread != null &&
              spread.n >= 2 &&
              (ghostAlwaysOn || hover === i || isPinned);
            return (
              <div
                key={i}
                className={cn(
                  "relative h-full flex-1 transition-transform duration-100",
                  onPinCell && "cursor-pointer",
                )}
                style={{
                  background: s.hex,
                  transform: hover === i ? "scaleY(1.03)" : undefined,
                  boxShadow: isPinned
                    ? "inset 0 0 0 2px var(--color-primary)"
                    : undefined,
                }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                onClick={() => {
                  if (!onPinCell) return;
                  onPinCell(pinnedIdx === fullI ? null : fullI);
                }}
                title={
                  spread && spread.n >= 2
                    ? `${s.hex} · ${fmtNum(s.x)} · N=${spread.n} · ΔE ${spread.spread.toFixed(1)}`
                    : `${s.hex} · ${fmtNum(s.x)}`
                }
              >
                {showFan && spread && <GhostFan spread={spread} />}
              </div>
            );
          })}
        </div>

        {/* Fine grain for physicality. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
          }}
        />

        {!cropped && (
          <>
            {/* Excluded regions — crosshatched dim overlay on either side
                of the active range. */}
            <ExcludedOverlay side="left" widthPct={startT * 100} />
            <ExcludedOverlay side="right" widthPct={(1 - endT) * 100} />

            {/* Active-range brackets — mix-blend-difference keeps them
                readable on any swatch colour. */}
            <RangeBracket leftPct={startT * 100} rightPct={endT * 100} />

            {/* Drag handles. */}
            <RangeHandle
              side="start"
              leftPct={startT * 100}
              label={fmtNum(rangeStart)}
              onGrab={() => setDragging("start")}
              active={dragging === "start"}
            />
            <RangeHandle
              side="end"
              leftPct={endT * 100}
              label={fmtNum(rangeEnd)}
              onGrab={() => setDragging("end")}
              active={dragging === "end"}
            />
          </>
        )}

        {hovered && (
          <div
            className="pointer-events-none absolute bottom-2 left-3 px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase"
            style={{ color: "white", mixBlendMode: "difference" }}
          >
            {hovered.hex} · {fmtNum(hovered.x)}
          </div>
        )}
      </div>

      {/* V2-B seismograph — per-cell ΔE spread rendered as a tiny
          separate bar beneath the swatch strip. Keeps the main strip
          clean (no tint over the colours) while giving a scan-friendly
          read of which parameter regions are unstable. Hidden when no
          cell has replicate data. */}
      {showVariability && maxVisibleSpread > 0 && (
        <VarianceSeismograph
          spreads={stripSpreads!}
          maxSpread={maxVisibleSpread}
        />
      )}

      {/* Axis ticks underneath — span the full sweep normally, but
          collapse to the active range when cropped. */}
      <div className="relative mt-2 h-6">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const x = stripXMin + f * (stripXMax - stripXMin);
          return (
            <div
              key={f}
              className="absolute top-0 -translate-x-1/2 text-center"
              style={{ left: `${f * 100}%` }}
            >
              <div
                aria-hidden
                className="mx-auto h-1.5 w-px bg-[color:var(--color-border-strong)]"
              />
              <div className="mt-0.5 font-mono text-[10px] text-[color:var(--color-ink-muted)] tabular-nums">
                {fmtNum(x)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------ Variability overlays (1D) ------------------------------- */

/**
 * V1-A — Halo fan on a SpectrumStrip cell. Renders a thin horizontal
 * row of per-result swatches along the cell's bottom edge, plus a
 * 1-px orange tick above it positioned at ``spread / maxSpread`` — a
 * sampled-gauge read for how much this specific cell disagrees across
 * runs.
 */
function GhostFan({ spread }: { spread: CellSpread }) {
  if (spread.n < 2) return null;
  // Cap fan density so the swatches stay visually discrete; anything
  // beyond 12 collapses into a "+N" tag at the far right.
  const MAX_VISIBLE = 12;
  const visible = spread.labs.slice(0, MAX_VISIBLE);
  const overflow = spread.n - visible.length;
  // Use labs straight from the CellSpread — same index-order the
  // backend sent. Convert back to CSS rgb via a tiny Lab→hex.
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end h-[26%]">
      {/* ΔE tick ribbon above the swatches */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{
          background: "var(--color-surface)",
          opacity: 0.35,
        }}
      />
      {spread.maxSpread > 0 && (
        <div
          className="absolute -top-[2px] h-[4px] w-[2px] rounded-sm"
          style={{
            left: `calc(${Math.min(1, spread.spread / spread.maxSpread) * 100}% - 1px)`,
            background: "var(--color-primary)",
          }}
        />
      )}
      <div className="relative flex-1 flex">
        {visible.map((lab, i) => (
          <div
            key={i}
            className="h-full flex-1"
            style={{
              background: labToHex(lab),
              opacity: 0.92,
            }}
          />
        ))}
        {overflow > 0 && (
          <div
            className="h-full px-1 flex items-center font-mono text-[9px] tracking-[0.08em]"
            style={{
              background: "rgba(0,0,0,0.55)",
              color: "white",
            }}
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * V2-B — ΔE seismograph. A dedicated thin bar rendered beneath the
 * main SpectrumStrip. At each cell's x position we draw a vertical
 * hatch whose height = ``spread / maxSpread`` and whose colour lives
 * on the ΔE tone ramp (slate → warm → primary). A dashed outer
 * overlay tracks ``maxSpread`` so outliers beyond the mean are still
 * visible without dominating the read.
 *
 * Sits on its own surface so the engraved colours on the main strip
 * stay unmuddied — the earlier V2-A variant laid this band on top of
 * the cells and tinted them.
 */
function VarianceSeismograph({
  spreads,
  maxSpread,
}: {
  spreads: CellSpread[];
  maxSpread: number;
}) {
  // Fixed pixel height — small enough not to dominate; tall enough to
  // read magnitude at a glance.
  const HEIGHT = 22;
  // Summary numbers in a mono-caps header above the bar.
  const meanSpread =
    spreads.filter((s) => s.n >= 2).reduce((acc, s) => acc + s.spread, 0) /
    Math.max(1, spreads.filter((s) => s.n >= 2).length);
  const worstSpread = Math.max(...spreads.map((s) => s.maxSpread), 0);
  const worstIdx = spreads.reduce(
    (best, sp, i) => (sp.maxSpread > spreads[best].maxSpread ? i : best),
    0,
  );
  return (
    <div className="mt-1">
      <div className="flex items-baseline justify-between font-mono text-[9.5px] tracking-[0.16em] uppercase text-[color:var(--color-ink-subtle)] mb-0.5">
        <span>stability · ΔE per cell</span>
        <span className="tabular-nums text-[color:var(--color-ink-muted)]">
          avg ΔE {meanSpread.toFixed(2)} · worst ΔE {worstSpread.toFixed(2)}
          {` @ cell ${worstIdx + 1}`}
        </span>
      </div>
      <div
        className="relative rounded-[4px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden"
        style={{ height: HEIGHT }}
      >
        {/* Baseline grid — three faint horizontal ticks at 25 / 50 / 75 %
            so the eye can estimate "how big is this bar" without a y-axis. */}
        {[0.25, 0.5, 0.75].map((f) => (
          <div
            key={f}
            aria-hidden
            className="absolute inset-x-0 h-px"
            style={{
              top: `${f * 100}%`,
              background: "var(--color-border)",
              opacity: 0.35,
            }}
          />
        ))}
        <svg
          viewBox={`0 0 ${spreads.length} 1`}
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          aria-hidden
        >
          {spreads.map((sp, i) => {
            if (sp.n < 2) return null;
            const h = sp.spread / maxSpread; // 0..1
            // Tone: slate when stable, primary when trending unstable.
            // 4 ΔE76 is "clearly off"; 2 ΔE is "noticeable on inspection".
            const t = Math.min(1, sp.spread / 4);
            const stroke = `rgba(${Math.round(132 + t * 52)}, ${Math.round(
              120 - t * 55,
            )}, ${Math.round(110 - t * 96)}, ${0.55 + t * 0.4})`;
            return (
              <rect
                key={i}
                x={i + 0.05}
                y={1 - h}
                width={0.9}
                height={h}
                fill={stroke}
              />
            );
          })}
          {/* Outlier hint — the max-spread overlay as a dashed polyline
              so the peak per cell is still legible even when the mean bar
              is short. */}
          <polyline
            fill="none"
            stroke="var(--color-primary)"
            strokeOpacity={0.55}
            strokeWidth={0.02}
            strokeDasharray="0.15 0.1"
            points={spreads
              .map((sp, i) => {
                const h = sp.n >= 2 ? sp.maxSpread / maxSpread : 0;
                return `${i + 0.5},${1 - h}`;
              })
              .join(" ")}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

function StripLabel({
  text,
  hint,
  meta,
}: {
  text: string;
  hint?: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-1.5">
      <div className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="h-px w-3 bg-[color:var(--color-border-strong)]"
        />
        <span
          className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]"
          title={hint}
        >
          {text}
        </span>
      </div>
      {meta && <div className="flex items-center gap-1.5">{meta}</div>}
    </div>
  );
}

function MetaChip({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  hint?: string;
}) {
  const toneColor =
    tone === "good"
      ? "var(--color-success)"
      : tone === "warn"
        ? "var(--color-warning)"
        : tone === "bad"
          ? "var(--color-destructive)"
          : "var(--color-ink-muted)";
  return (
    <span
      title={hint}
      className={cn(
        "inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-[4px]",
        "border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]",
        "font-mono text-[10.5px] tabular-nums",
      )}
    >
      <span className="text-[9px] font-semibold tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span style={{ color: toneColor }}>{value}</span>
    </span>
  );
}

function ModeledStrip({
  strip,
  fullXMin,
  fullXMax,
  rangeStart,
  rangeEnd,
  cropped,
}: {
  strip: { x: number; hex: string }[];
  fullXMin: number;
  fullXMax: number;
  rangeStart: number;
  rangeEnd: number;
  cropped: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // When cropped, only show the in-range predictions — no extrapolation
  // hatching, no fit-boundary verticals, no dead-zone colour wash.
  const stripXMin = cropped ? rangeStart : fullXMin;
  const stripXMax = cropped ? rangeEnd : fullXMax;
  const cells = cropped
    ? strip.filter((s) => s.x >= rangeStart && s.x <= rangeEnd)
    : strip;
  const hovered = hover != null ? cells[hover] : null;
  const t = (x: number) => {
    const range = stripXMax - stripXMin || 1;
    return (x - stripXMin) / range;
  };
  const startT = t(rangeStart);
  const endT = t(rangeEnd);
  return (
    <div
      className="relative rounded-[8px] overflow-hidden border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] select-none"
      style={{ height: 54 }}
    >
      <div className="absolute inset-0 flex">
        {cells.map((s, i) => (
          <div
            key={i}
            className="h-full flex-1"
            style={{ background: s.hex }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            title={`${s.hex} · ${fmtNum(s.x)}`}
          />
        ))}
      </div>
      {!cropped && (
        <>
          {/* Hatched flagging on the extrapolated (out-of-fit) regions so
              the user can see the predictions but knows they're untrained. */}
          <ExtrapolationOverlay side="left" widthPct={startT * 100} />
          <ExtrapolationOverlay side="right" widthPct={(1 - endT) * 100} />
          {/* Fit boundary ticks — thin dashed lines where the active range ends. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0"
            style={{
              left: `${startT * 100}%`,
              borderLeft: "1px dashed white",
              mixBlendMode: "difference",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0"
            style={{
              left: `${endT * 100}%`,
              borderLeft: "1px dashed white",
              mixBlendMode: "difference",
            }}
          />
        </>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute bottom-2 left-3 px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase"
          style={{ color: "white", mixBlendMode: "difference" }}
        >
          {hovered.hex} · {fmtNum(hovered.x)}
        </div>
      )}
    </div>
  );
}

function ExtrapolationOverlay({
  side,
  widthPct,
}: {
  side: "left" | "right";
  widthPct: number;
}) {
  if (widthPct <= 0.01) return null;
  const style: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: `${widthPct}%`,
    // Lighter hatched than the sampled strip's dim — the user is meant
    // to read through it, since this is the whole point of the modeled
    // strip (show me the prediction for the dead zones).
    background:
      "repeating-linear-gradient(-45deg, rgba(20,10,0,0.22) 0 4px, transparent 4px 8px)",
    pointerEvents: "none",
  };
  if (side === "left") style.left = 0;
  else style.right = 0;
  return <div aria-hidden style={style} />;
}

function ExcludedOverlay({
  side,
  widthPct,
}: {
  side: "left" | "right";
  widthPct: number;
}) {
  if (widthPct <= 0.01) return null;
  const style: React.CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: `${widthPct}%`,
    background:
      "repeating-linear-gradient(-45deg, rgba(10,10,10,0.55) 0 6px, rgba(10,10,10,0.4) 6px 9px)",
    backdropFilter: "grayscale(0.8)",
    WebkitBackdropFilter: "grayscale(0.8)",
    pointerEvents: "none",
  };
  if (side === "left") style.left = 0;
  else style.right = 0;
  return <div aria-hidden style={style} />;
}

function RangeBracket({
  leftPct,
  rightPct,
}: {
  leftPct: number;
  rightPct: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0"
      style={{
        left: `${leftPct}%`,
        right: `${100 - rightPct}%`,
        borderLeft: "1.5px solid white",
        borderRight: "1.5px solid white",
        mixBlendMode: "difference",
      }}
    />
  );
}

function RangeHandle({
  side,
  leftPct,
  label,
  onGrab,
  active,
}: {
  side: "start" | "end";
  leftPct: number;
  label: string;
  onGrab: () => void;
  active: boolean;
}) {
  return (
    <div
      role="slider"
      aria-label={`Range ${side}`}
      className={cn(
        "absolute top-0 bottom-0 z-10 flex flex-col items-center cursor-ew-resize group",
      )}
      style={{
        left: `${leftPct}%`,
        transform: "translateX(-50%)",
        width: 14,
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onGrab();
      }}
    >
      {/* Grip. */}
      <div
        className={cn(
          "my-auto h-8 w-[3px] rounded-full",
          "bg-[color:var(--color-primary)] shadow-[0_0_0_2px_rgba(0,0,0,0.2)]",
          "transition-transform",
          active && "scale-y-110",
        )}
      />
      {/* Label tag on the outer side. */}
      <div
        className={cn(
          "absolute top-full mt-1.5 px-1.5 py-0.5 rounded-[4px]",
          "font-mono text-[10px] tabular-nums font-semibold",
          "bg-[color:var(--color-primary)] text-white whitespace-nowrap",
          "shadow-[0_1px_3px_rgba(0,0,0,0.25)]",
          active || "opacity-80 group-hover:opacity-100",
        )}
        style={{
          transform: side === "start" ? "translateX(-50%)" : "translateX(-50%)",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function RangeControls({
  xParam,
  fullXMin,
  fullXMax,
  rangeStart,
  rangeEnd,
  onChange,
  onReset,
  clipped,
  cropped,
  onToggleCrop,
  activeCount,
  totalCount,
}: {
  xParam: string;
  fullXMin: number;
  fullXMax: number;
  rangeStart: number;
  rangeEnd: number;
  onChange: (start: number, end: number) => void;
  onReset: () => void;
  clipped: boolean;
  cropped: boolean;
  onToggleCrop: () => void;
  activeCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
        {clipped ? `${activeCount} / ${totalCount} samples` : `${totalCount} samples`}
      </span>
      <div className="flex items-center gap-1.5">
        <NumInput
          label={`${xParam} min`}
          value={rangeStart}
          onCommit={(v) => onChange(v, rangeEnd)}
          min={fullXMin}
          max={fullXMax}
        />
        <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">→</span>
        <NumInput
          label={`${xParam} max`}
          value={rangeEnd}
          onCommit={(v) => onChange(rangeStart, v)}
          min={fullXMin}
          max={fullXMax}
        />
      </div>
      <button
        type="button"
        onClick={onToggleCrop}
        disabled={!clipped}
        title={
          clipped
            ? cropped
              ? "Show the full sweep with dim-flagged dead zones"
              : "Zoom the strips to just the active range"
            : "Clip the range first to enable cropping"
        }
        className={cn(
          "h-6 px-2 rounded-[6px] font-mono text-[10.5px] font-semibold tracking-[0.06em]",
          "border transition-colors",
          !clipped && "opacity-40 cursor-default",
          clipped && cropped
            ? "bg-[color:var(--color-primary)] border-[color:var(--color-primary)] text-white"
            : clipped
              ? "bg-[color:var(--color-surface-elevated)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)]/50"
              : "bg-transparent border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)]",
        )}
      >
        crop
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={!clipped && !cropped}
        className={cn(
          "h-6 px-2 rounded-[6px] font-mono text-[10.5px] font-semibold tracking-[0.06em]",
          "border transition-colors",
          clipped || cropped
            ? "bg-[color:var(--color-surface-elevated)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)]/50"
            : "bg-transparent border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] opacity-40 cursor-default",
        )}
      >
        reset
      </button>
    </div>
  );
}

function NumInput({
  label,
  value,
  onCommit,
  min,
  max,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
}) {
  // Local buffer so the user can edit freely without fighting state on every keystroke.
  const [local, setLocal] = useState(fmtInput(value));
  useEffect(() => {
    setLocal(fmtInput(value));
  }, [value]);
  const commit = (raw: string) => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      setLocal(fmtInput(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    onCommit(clamped);
  };
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => commit(local)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(local);
          if (e.key === "Escape") setLocal(fmtInput(value));
        }}
        className={cn(
          "h-6 w-[72px] px-1.5 rounded-[5px] font-mono text-[11px] tabular-nums text-right",
          "border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
          "focus:outline-none focus:border-[color:var(--color-primary)]/60 focus:ring-2 focus:ring-[color:var(--color-primary)]/20",
        )}
        title={label}
      />
    </label>
  );
}

function fmtInput(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  // Trim trailing zeros on floats.
  return String(Number(n.toFixed(3)));
}

function PlotPlaceholder() {
  return (
    <div className="py-10 text-center font-mono text-[11px] tracking-[0.14em] uppercase text-[color:var(--color-ink-subtle)]">
      Not enough samples in range
    </div>
  );
}

/* ---------- Projection chips ------------------------------------------ */

function ProjectionChips({
  value,
  onChange,
}: {
  value: Projection;
  onChange: (p: Projection) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {(Object.keys(PROJ_META) as Projection[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          title={PROJ_META[p].full}
          className={cn(
            "px-2 h-6 rounded-[6px] font-mono text-[10.5px] font-semibold tracking-[0.06em]",
            "border transition-colors",
            value === p
              ? "bg-[color:var(--color-primary)] border-[color:var(--color-primary)] text-white"
              : "bg-[color:var(--color-surface-elevated)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-primary)]/50",
          )}
        >
          {PROJ_META[p].label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Scatter plot ---------------------------------------------- */

function PlotSvg({
  samples,
  ys,
  xLabel,
  yLabel,
  fit,
}: {
  samples: { x: number; hex: string; lab: Lab }[];
  ys: number[];
  xLabel: string;
  yLabel: string;
  fit: PolyFit | null;
}) {
  const W = 680;
  const H = 360;
  const PADL = 52;
  const PADR = 14;
  const PADT = 16;
  const PADB = 40;

  // Tiny X-axis padding so the first and last points don't sit on top of
  // the Y-axis / right plot edge (their hover halo would clip off).
  const xDataMin = samples[0].x;
  const xDataMax = samples[samples.length - 1].x;
  const xPad = (xDataMax - xDataMin) * 0.025;
  const xMin = xDataMin - xPad;
  const xMax = xDataMax + xPad;
  const xRange = xMax - xMin || 1;

  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  // Slight padding on Y.
  const pad = (yMax - yMin) * 0.05;
  yMin -= pad;
  yMax += pad;
  const yRange = yMax - yMin;

  const xToPx = (x: number) =>
    PADL + ((x - xMin) / xRange) * (W - PADL - PADR);
  const yToPx = (y: number) =>
    PADT + (1 - (y - yMin) / yRange) * (H - PADT - PADB);

  // Fit curve — sample the polynomial at many points.
  let fitPath = "";
  if (fit) {
    const steps = 80;
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const xi = xMin + t * xRange;
      const yi = evalPoly(fit.coeffs, xi);
      pts.push(`${xToPx(xi).toFixed(2)},${yToPx(yi).toFixed(2)}`);
    }
    fitPath = `M ${pts.join(" L ")}`;
  }

  // Y-axis ticks (~5).
  const yTicks = niceTicks(yMin, yMax, 5);
  const xTicks = niceTicks(xMin, xMax, 6);

  // Click-to-peek: show value of nearest sample on hover.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]"
        onMouseMove={(e) => {
          const rect = svgRef.current!.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const xv = xMin + ((px - PADL) / (W - PADL - PADR)) * xRange;
          // nearest sample index
          let bestI = 0, bestD = Infinity;
          for (let i = 0; i < samples.length; i++) {
            const d = Math.abs(samples[i].x - xv);
            if (d < bestD) { bestD = d; bestI = i; }
          }
          setHoverIdx(bestI);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Grid-paper background. */}
        {yTicks.map((t) => (
          <line
            key={`gy-${t}`}
            x1={PADL}
            x2={W - PADR}
            y1={yToPx(t)}
            y2={yToPx(t)}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            opacity={0.6}
          />
        ))}
        {xTicks.map((t) => (
          <line
            key={`gx-${t}`}
            x1={xToPx(t)}
            x2={xToPx(t)}
            y1={PADT}
            y2={H - PADB}
            stroke="var(--color-border)"
            strokeDasharray="2 4"
            opacity={0.4}
          />
        ))}

        {/* Axes. */}
        <line
          x1={PADL}
          x2={PADL}
          y1={PADT}
          y2={H - PADB}
          stroke="var(--color-border-strong)"
        />
        <line
          x1={PADL}
          x2={W - PADR}
          y1={H - PADB}
          y2={H - PADB}
          stroke="var(--color-border-strong)"
        />

        {/* Fit curve (behind points). */}
        {fitPath && (
          <path
            d={fitPath}
            fill="none"
            stroke="var(--color-secondary)"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            opacity={0.75}
          />
        )}

        {/* Scatter points filled with their actual hex. */}
        {samples.map((s, i) => (
          <circle
            key={i}
            cx={xToPx(s.x)}
            cy={yToPx(ys[i])}
            r={hoverIdx === i ? 6 : 4}
            fill={s.hex}
            stroke="rgba(0,0,0,0.45)"
            strokeWidth={0.75}
          />
        ))}

        {/* Hover crosshair + readout. */}
        {hoverIdx != null && (
          <>
            <line
              x1={xToPx(samples[hoverIdx].x)}
              x2={xToPx(samples[hoverIdx].x)}
              y1={PADT}
              y2={H - PADB}
              stroke="var(--color-primary)"
              strokeDasharray="3 3"
              opacity={0.45}
            />
            <circle
              cx={xToPx(samples[hoverIdx].x)}
              cy={yToPx(ys[hoverIdx])}
              r={8}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={1}
              opacity={0.75}
            />
          </>
        )}

        {/* Y tick labels. */}
        {yTicks.map((t) => (
          <g key={`yl-${t}`}>
            <text
              x={PADL - 6}
              y={yToPx(t) + 3}
              textAnchor="end"
              className="fill-[color:var(--color-ink-muted)]"
              style={{ font: "10px var(--font-mono)" }}
            >
              {fmtNum(t)}
            </text>
          </g>
        ))}

        {/* X tick labels. */}
        {xTicks.map((t) => (
          <text
            key={`xl-${t}`}
            x={xToPx(t)}
            y={H - PADB + 16}
            textAnchor="middle"
            className="fill-[color:var(--color-ink-muted)]"
            style={{ font: "10px var(--font-mono)" }}
          >
            {fmtNum(t)}
          </text>
        ))}

        {/* Axis labels. */}
        <text
          x={PADL - 40}
          y={PADT + (H - PADT - PADB) / 2}
          textAnchor="middle"
          className="fill-[color:var(--color-ink-subtle)]"
          transform={`rotate(-90, ${PADL - 40}, ${PADT + (H - PADT - PADB) / 2})`}
          style={{
            font: "600 9.5px var(--font-mono)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          {yLabel}
        </text>
        <text
          x={(W - PADL - PADR) / 2 + PADL}
          y={H - 6}
          textAnchor="middle"
          className="fill-[color:var(--color-ink-subtle)]"
          style={{
            font: "600 9.5px var(--font-mono)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          {xLabel}
        </text>
      </svg>

      {/* Hover readout badge. */}
      {hoverIdx != null && (
        <div className="absolute top-3 right-3 inline-flex items-center gap-2 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 py-1 shadow-[var(--shadow-card)]">
          <span
            className="h-3 w-3 rounded-sm border border-[color:var(--color-border-strong)]"
            style={{ background: samples[hoverIdx].hex }}
          />
          <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink)]">
            {fmtNum(samples[hoverIdx].x)} · {fmtNum(ys[hoverIdx])}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------- Fit panel ------------------------------------------------- */

function FitPanel({
  fitDegree,
  onChangeDegree,
  fit,
  xParam,
  yUnit,
  proj,
  projection,
  canSave,
  onSave,
}: {
  fitDegree: 0 | 1 | 2 | 3;
  onChangeDegree: (d: 0 | 1 | 2 | 3) => void;
  fit: PolyFit | null;
  xParam: string;
  yUnit: string;
  proj: ReturnType<typeof computeProjection>;
  projection: Projection;
  canSave: boolean;
  onSave: () => void;
}) {
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-4 space-y-4">
      <div>
        <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          Fit degree
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onChangeDegree(d as 0 | 1 | 2 | 3)}
              className={cn(
                "h-7 rounded-[6px] font-mono text-[11px] border transition-colors",
                d === fitDegree
                  ? "bg-[color:var(--color-primary)] border-[color:var(--color-primary)] text-white"
                  : "bg-[color:var(--color-surface)] border-[color:var(--color-border)] text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
              )}
            >
              {d === 0 ? "off" : `deg ${d}`}
            </button>
          ))}
        </div>
      </div>
      {fit && (
        <div>
          <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            r²
          </div>
          <div className="mt-1 font-mono text-[18px] tabular-nums text-[color:var(--color-ink)]">
            {fit.r2.toFixed(4)}
          </div>
          <div className="mt-2 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)] leading-relaxed break-words">
            ŷ = {formatPoly(fit.coeffs, xParam)}
          </div>
          <div className="mt-1 font-mono text-[9.5px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
            fit unit · {yUnit}
          </div>
        </div>
      )}
      {projection === "pc1" && proj.variance_ratio != null && (
        <div className="rounded-[6px] bg-[color:var(--color-secondary-tint)] px-3 py-2">
          <div className="font-mono text-[9.5px] font-semibold tracking-[0.2em] uppercase text-[color:var(--color-secondary)]">
            PC1 captures
          </div>
          <div className="mt-0.5 font-mono text-[14px] text-[color:var(--color-ink)] tabular-nums">
            {(proj.variance_ratio * 100).toFixed(1)}%
          </div>
          <p className="mt-1 text-[11px] text-[color:var(--color-ink-muted)] leading-snug">
            of the spectrum's Lab variance. Close to 100% means the sweep
            traces an almost-1-D curve — PC1 is then the "right" axis.
          </p>
        </div>
      )}
      <button
        type="button"
        disabled={!canSave}
        onClick={onSave}
        title={
          canSave
            ? "Save this cropped sub-spectrum + its fit equation"
            : "Crop the range and pick a fit degree to save."
        }
        className={cn(
          "w-full h-9 rounded-[6px] font-mono text-[11px] uppercase tracking-[0.18em] transition-colors",
          canSave
            ? "bg-[color:var(--color-primary)] text-white hover:bg-[color:var(--color-primary-tint)]"
            : "bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-[color:var(--color-ink-subtle)] cursor-not-allowed",
        )}
      >
        Save spectrum
      </button>
    </div>
  );
}

/* ---------- Step ΔE chart --------------------------------------------- */

function StepDeltaChart({
  steps,
  xMin,
  xMax,
}: {
  steps: { i: number; x1: number; x2: number; dE: number; hex1: string; hex2: string }[];
  xMin: number;
  xMax: number;
}) {
  if (steps.length === 0) return null;
  const H = 140;
  const W = 680;
  const PADL = 52;
  const PADR = 14;
  const PADT = 12;
  const PADB = 24;
  const maxDE = Math.max(...steps.map((s) => s.dE), 1);
  const xRange = xMax - xMin || 1;
  const xToPx = (x: number) => PADL + ((x - xMin) / xRange) * (W - PADL - PADR);
  const yToPx = (v: number) =>
    PADT + (1 - v / maxDE) * (H - PADT - PADB);

  const barW = Math.max(
    1.5,
    ((W - PADL - PADR) / steps.length) * 0.8,
  );

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)]"
      >
        <line
          x1={PADL}
          x2={W - PADR}
          y1={H - PADB}
          y2={H - PADB}
          stroke="var(--color-border-strong)"
        />
        {steps.map((s) => {
          const mid = (s.x1 + s.x2) / 2;
          return (
            <g key={s.i}>
              <defs>
                <linearGradient id={`step-${s.i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.hex2} />
                  <stop offset="100%" stopColor={s.hex1} />
                </linearGradient>
              </defs>
              <rect
                x={xToPx(mid) - barW / 2}
                y={yToPx(s.dE)}
                width={barW}
                height={H - PADB - yToPx(s.dE)}
                fill={`url(#step-${s.i})`}
                stroke="rgba(0,0,0,0.4)"
                strokeWidth={0.5}
              >
                <title>{`ΔE ${s.dE.toFixed(2)} · ${fmtNum(s.x1)} → ${fmtNum(s.x2)}`}</title>
              </rect>
            </g>
          );
        })}
        <text
          x={PADL - 6}
          y={yToPx(maxDE) + 3}
          textAnchor="end"
          className="fill-[color:var(--color-ink-muted)]"
          style={{ font: "10px var(--font-mono)" }}
        >
          {maxDE.toFixed(1)}
        </text>
        <text
          x={PADL - 6}
          y={yToPx(0) + 3}
          textAnchor="end"
          className="fill-[color:var(--color-ink-muted)]"
          style={{ font: "10px var(--font-mono)" }}
        >
          0
        </text>
      </svg>
      <p className="mt-2 font-mono text-[10.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
        Tall bars mark parameter ranges where a small step yields a big
        colour jump — the "useful" part of the sweep. Flat sections waste
        parameter space on visually-indistinguishable swatches.
      </p>
    </div>
  );
}

/* ---------- Colour oracle --------------------------------------------- */

function Oracle({
  hex,
  onHexChange,
  oracle,
  xParam,
}: {
  hex: string;
  onHexChange: (h: string) => void;
  oracle:
    | { hex: string; predictedX: number; deltaE: number; nearestHex: string }
    | null;
  xParam: string;
}) {
  return (
    <div className="grid md:grid-cols-[1fr_1.2fr] gap-4">
      <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-4 space-y-3">
        <div>
          <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            Target hex
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="color"
              value={/^#?[0-9a-fA-F]{6}$/.test(hex.trim()) ? (hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`) : "#B8410E"}
              onChange={(e) => onHexChange(e.target.value)}
              className="h-9 w-10 rounded-[6px] border border-[color:var(--color-border-strong)] cursor-pointer bg-transparent"
              aria-label="Pick a target colour"
            />
            <input
              type="text"
              value={hex}
              onChange={(e) => onHexChange(e.target.value)}
              placeholder="#c86b24"
              className={cn(
                "flex-1 h-9 px-2.5 rounded-[6px] font-mono text-[13px] tabular-nums",
                "border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
                "focus:outline-none focus:border-[color:var(--color-primary)]/60 focus:ring-2 focus:ring-[color:var(--color-primary)]/20",
              )}
            />
          </div>
        </div>
        <p className="font-mono text-[10.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
          Given a target colour, find the parameter value that best
          reproduces it on this material — nearest-neighbour in Lab, with
          linear interpolation between the two closest samples.
        </p>
      </div>

      <div
        className={cn(
          "rounded-[10px] border p-4",
          oracle
            ? "border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
            : "border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)]",
        )}
      >
        {!oracle ? (
          <div className="py-6 text-center font-mono text-[11px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
            Enter a valid hex to predict
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="flex shrink-0 flex-col gap-1 items-center">
              <div className="font-mono text-[9px] font-semibold tracking-[0.2em] uppercase text-[color:var(--color-ink-subtle)]">
                Target
              </div>
              <div
                className="h-16 w-16 rounded-[8px] border border-[color:var(--color-border-strong)]"
                style={{ background: oracle.hex }}
              />
              <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
                {oracle.hex}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-center gap-1 text-[color:var(--color-ink-subtle)]">
              <span className="font-mono text-[10px] tracking-[0.14em]">→</span>
              <span className="font-mono text-[9px] tracking-[0.14em] uppercase">
                ΔE {oracle.deltaE.toFixed(2)}
              </span>
            </div>
            <div className="flex shrink-0 flex-col gap-1 items-center">
              <div className="font-mono text-[9px] font-semibold tracking-[0.2em] uppercase text-[color:var(--color-ink-subtle)]">
                Nearest
              </div>
              <div
                className="h-16 w-16 rounded-[8px] border border-[color:var(--color-border-strong)]"
                style={{ background: oracle.nearestHex }}
              />
              <div className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink)]">
                {oracle.nearestHex}
              </div>
            </div>
            <div className="flex-1 min-w-0 pl-2 border-l border-[color:var(--color-border)]">
              <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
                Predicted {xParam}
              </div>
              <div className="mt-1 font-mono text-[22px] tabular-nums text-[color:var(--color-primary)] font-semibold">
                {fmtNum(oracle.predictedX)}
              </div>
              <div className="mt-1 font-mono text-[10px] tracking-[0.08em] uppercase text-[color:var(--color-ink-muted)]">
                {oracle.deltaE < 2
                  ? "close match — usable"
                  : oracle.deltaE < 6
                    ? "approximate — might drift"
                    : "poor match — outside spectrum"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Small helpers --------------------------------------------- */

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 10) return n.toFixed(2);
  return n.toFixed(3);
}

function formatPoly(coeffs: number[], x: string): string {
  const parts: string[] = [];
  for (let k = coeffs.length - 1; k >= 0; k--) {
    const c = coeffs[k];
    if (Math.abs(c) < 1e-12) continue;
    const term = k === 0 ? "" : k === 1 ? x : `${x}^${k}`;
    const sign = parts.length === 0 ? (c < 0 ? "−" : "") : c < 0 ? " − " : " + ";
    const mag = Math.abs(c);
    parts.push(`${sign}${mag.toExponential(2)}${term ? `·${term}` : ""}`);
  }
  return parts.join("") || "0";
}

function niceTicks(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rough = range / count;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const step = (n >= 7.5 ? 10 : n >= 3 ? 5 : n >= 1.5 ? 2 : 1) * pow;
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 0.0001; v += step) ticks.push(v);
  return ticks;
}
