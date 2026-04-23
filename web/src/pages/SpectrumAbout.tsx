import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  MetalBar,
} from "../ui";
import { DialogClose } from "@radix-ui/react-dialog";

type Tab = "1d" | "2d";

/**
 * The field manual. Opens from the ? button on the Spectrum pages.
 * Styled like a lab notebook — tick-marked section rules, monospace
 * caption labels, hand-drawn-feeling mini diagrams for every concept.
 *
 * The top of the manual is shared (pipeline + projection axes — same
 * ideas apply whether your test has one parameter or two). The tab
 * switcher controls which page-specific sections render below.
 */
export function SpectrumAbout({
  open,
  onOpenChange,
  initialTab = "1d",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // Reset the tab every time the dialog opens — the caller knows which
  // page the user is on, and we trust that hint over whatever tab
  // they last poked while inside.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        width="lg"
        className="p-0 overflow-hidden max-h-[85vh] flex flex-col"
      >
        <DialogTitle className="sr-only">
          Spectrum playground — field manual
        </DialogTitle>

        {/* Masthead */}
        <div className="relative shrink-0 px-6 pt-5 pb-4 bg-[color:var(--color-surface-elevated)]">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-1.5">
            <span
              className="h-px w-4 bg-[color:var(--color-border-strong)]"
              aria-hidden
            />
            Field manual · vol.1
          </div>
          <h2 className="text-[19px] font-semibold text-[color:var(--color-ink)] leading-tight">
            {tab === "1d"
              ? "How a burned test becomes a plot"
              : "How a 2-axis sweep becomes three plots"}
          </h2>
          <p className="mt-1 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed max-w-[62ch]">
            {tab === "1d" ? (
              <>
                The 1-axis Spectrum page collapses three colour channels into
                one number per swatch, then lets you fit a curve to it. Pick
                the{" "}
                <strong className="text-[color:var(--color-ink)]">projection</strong>{" "}
                (how to collapse) and the{" "}
                <strong className="text-[color:var(--color-ink)]">fit degree</strong>{" "}
                (how much curvature) — different choices tell different
                stories about the same sweep.
              </>
            ) : (
              <>
                The 2-axis page looks at the same Lab-space data through three
                different lenses on one scrolling document: the{" "}
                <strong className="text-[color:var(--color-ink)]">atlas</strong>{" "}
                is the measured grid, the{" "}
                <strong className="text-[color:var(--color-ink)]">drift map</strong>{" "}
                shows how the two inputs move colour across Lab, and the{" "}
                <strong className="text-[color:var(--color-ink)]">crosshair strips</strong>{" "}
                expose each parameter's marginal effect.
              </>
            )}
          </p>
          <DialogClose
            aria-label="Close"
            className={cn(
              "absolute top-3 right-3 h-7 w-7 inline-flex items-center justify-center rounded-full",
              "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)]",
              "hover:bg-[color:var(--color-surface)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
            )}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </DialogClose>
        </div>

        <MetalBar />

        {/* Tab switcher — sits between masthead and body so it's always
            visible without being glued to the header proper. */}
        <div className="px-6 pt-3 pb-2 shrink-0 bg-[color:var(--color-surface-elevated)]">
          <div className="inline-flex rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] overflow-hidden">
            <TabButton active={tab === "1d"} onClick={() => setTab("1d")}>
              1-axis
            </TabButton>
            <TabButton active={tab === "2d"} onClick={() => setTab("2d")}>
              2-axis
            </TabButton>
          </div>
        </div>

        <MetalBar variant="soft" />

        {/* Body scrolls independently so the masthead + tabs stay visible. */}
        <div className="overflow-y-auto flex-1">
          <Pipeline />

          <Divider />

          <Section title="Projections · pick your axis">
            <p className="mb-4 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
              Each swatch is a 3-D point in CIE L*a*b* space. The Y axis of
              the plot is always one number per swatch — which is why you
              have to pick which one.
            </p>
            <div className="space-y-3.5">
              <ProjRow
                label="PC1"
                tag="the data-chosen axis"
                viz={<VizPC1 />}
              >
                <strong>Principal Component 1.</strong> Your sweep's colours
                trace a curve through Lab space. PC1 is the single straight
                line along which the points are most spread out. Projecting
                onto it keeps the most information possible when crushing
                three dimensions into one.
                <br />
                <em className="text-[color:var(--color-ink-subtle)]">
                  Use when you want the most faithful 1-D summary. If the{" "}
                  <span className="font-mono">PC1 variance</span> ministat reads &gt;95%, PC1
                  is basically the whole story.
                </em>
              </ProjRow>

              <ProjRow label="L*" tag="how light, how dark" viz={<VizL />}>
                Just lightness. Ignores hue and saturation completely. Clean
                readout for sweeps that are mostly darkening ramps — e.g.
                power sweeps on anodised surfaces.
              </ProjRow>

              <ProjRow label="C*" tag="how vivid" viz={<VizC />}>
                Chroma — distance from the neutral axis in Lab. Zero is pure
                grey; large values are saturated. Use when the sweep goes
                from washed out to vivid (or vice versa).
              </ProjRow>

              <ProjRow label="h°" tag="what kind of colour" viz={<VizHue />}>
                Hue angle in Lab's a*b* plane —{" "}
                <span className="font-mono">atan2(b*, a*)</span>. 0° red,
                60° yellow-orange, 120° green, 240° blue, 330° magenta.
                <br />
                Two flavours:
                <br />
                <strong className="font-mono">h°</strong> unwraps the
                angle so successive samples don't jump at the 0°/360° seam
                — the y-axis becomes a running cumulative angle (can go
                negative or past 360°). Good for reading sweep direction.
                <br />
                <strong className="font-mono">h°raw</strong> leaves it
                wrapped in [0°, 360°] — the honest polar angle of each
                swatch. Easier to compare to external tools (Photoshop
                LCH, colour-science). Shows a sawtooth whenever the sweep
                crosses the seam.
              </ProjRow>

              <ProjRow
                label="a* / b*"
                tag="red↔green · yellow↔blue"
                viz={<VizAb />}
              >
                The two colour-opponent channels of Lab. Raw data dumps.
                Useful when you suspect one channel is moving while the
                other stays put — compare them back-to-back.
              </ProjRow>

              <ProjRow
                label="dE0"
                tag="distance travelled from the first swatch"
                viz={<VizDeltaE />}
              >
                ΔE₇₆ between each swatch and the leftmost one. Always
                starts at zero and grows. A perfectly intuitive "progress
                through the sweep" axis — doesn't tell you <em>which</em>{" "}
                direction the colour went, only <em>how far</em>.
              </ProjRow>
            </div>
            {tab === "2d" && (
              <div className="mt-4 rounded-[8px] bg-[color:var(--color-primary-tint)] px-3.5 py-2.5">
                <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
                  2-axis note
                </div>
                <p className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
                  The atlas's <strong>contour axis</strong> chip-row uses this
                  same projection idea — pick L*/a*/b*/C*/h° and the grid's
                  iso-value curves redraw against that axis. PC1 is skipped
                  there because 2-D data produces a PC1/PC2 plane, which the
                  <strong> drift map</strong> visualises in full.
                </p>
              </div>
            )}
          </Section>

          <Divider />

          {tab === "2d" ? (
            <TwoDSections />
          ) : (
            <OneDSections />
          )}

          <div className="h-4" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- */
/* 1-axis only sections                                             */
/* ---------------------------------------------------------------- */

function OneDSections() {
  return (
    <>
      <Section title="Fit degree · how wobbly">
            <p className="mb-4 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
              A polynomial of degree N has N "bends". Higher degree can
              follow more of the data, but extrapolates wildly. Start at
              deg 2; only go higher if the residual ΔE is stubborn.
            </p>
            <div className="grid grid-cols-4 gap-3">
              <FitCard
                label="Off"
                sub="just the scatter"
                viz={<VizFit degree={0} />}
                text="No fit. Look at the raw points."
              />
              <FitCard
                label="Deg 1"
                sub="linear"
                viz={<VizFit degree={1} />}
                text="Straight line. Good for noisy monotonic sweeps."
              />
              <FitCard
                label="Deg 2"
                sub="parabola"
                viz={<VizFit degree={2} />}
                text="One bend — ramp up then plateau. Safe default."
              />
              <FitCard
                label="Deg 3"
                sub="s-curve"
                viz={<VizFit degree={3} />}
                text="Two bends. Fits most single-peak spectra; wild outside the range."
              />
            </div>
            <div className="mt-3 rounded-[8px] bg-[color:var(--color-secondary-tint)] px-3.5 py-2.5">
              <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-secondary)]">
                Reading R²
              </div>
              <p className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
                Fraction of the Y-variance the fit explains. 1.0 = perfect,
                0 = useless. Above the plot the modelled strip also shows{" "}
                <span className="font-mono">residual ΔE</span> — the
                polynomial's average colour-error in perceptual units.
                &lt;1.5 is imperceptible, ~3 is just noticeable, &gt;6 is
                clearly off.
              </p>
            </div>
          </Section>

          <Divider />

          <Section title="Clip · crop · oracle">
            <div className="grid md:grid-cols-3 gap-4">
              <MiniCard
                kicker="Clip"
                title="Exclude the dead zones"
                body="Drag the handles on the spectrum strip, or type numbers. Everything below — PCA, fits, step-ΔE, oracle — recomputes on just the active range. Bracket marks and hatched overlays show what's excluded."
              />
              <MiniCard
                kicker="Crop"
                title="Zoom in, hide the rest"
                body="Once clipped, hit crop to re-scale the strips to the active range only. Great for screenshots or for staring at just the useful window without the noisy bookends."
              />
              <MiniCard
                kicker="Oracle"
                title="Target → parameter"
                body="Paste or pick a hex, get the parameter value that reproduces it best. Uses nearest-neighbour in Lab with a linear interpolation to the next-closest sample. Reports ΔE to the match so you know whether to trust it."
              />
            </div>
          </Section>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* 2-axis only sections                                             */
/* ---------------------------------------------------------------- */

function TwoDSections() {
  return (
    <>
      <Section title="Atlas · the measured grid">
        <p className="mb-4 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
          One cell per sample at its real ({"x"}, {"y"}) position on the
          parameter grid. No interpolation — what you see is what the
          laser produced. Iso-contour lines overlay the cells so you can
          read "all settings that produce L*≈50" at a glance.
        </p>
        <div className="grid grid-cols-[150px_1fr] gap-4 items-start">
          <div className="h-[100px] rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden p-1.5">
            <VizAtlasContours />
          </div>
          <div className="text-[12.5px] text-[color:var(--color-ink)] leading-relaxed">
            <p>
              <strong>Contour axis</strong> picks which Lab channel the
              iso-lines follow — see the projections section above for
              what each axis means. <strong>Threshold</strong> drags
              the centre iso-line through the axis's value range;{" "}
              <strong>contour lines</strong> fans 1 / 3 / 5 lines around
              it so you can read local gradient steepness.
            </p>
            <p className="mt-2 text-[color:var(--color-ink-muted)]">
              Click a cell to pin it — the threshold snaps to that
              cell's value and the same cell highlights in the drift map
              and crosshair strips below. Click again to unpin.
            </p>
          </div>
        </div>
      </Section>

      <Divider />

      <Section title="Drift map · PC1 × PC2">
        <p className="mb-4 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
          Every sample plotted as a dot in 2-D colour space (PC1 × PC2).
          Dots are coloured by their actual hex. A sweep that truly spans
          2-D colour space will fill a patch; one where the two
          parameters redundantly control the same thing collapses onto a
          line.
        </p>
        <div className="grid grid-cols-[150px_1fr] gap-4 items-start">
          <div className="h-[100px] rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden p-1.5">
            <VizDriftThreads />
          </div>
          <div className="text-[12.5px] text-[color:var(--color-ink)] leading-relaxed">
            <p>
              <strong>Threads</strong> connect samples sharing a row
              (primary) or column (secondary) of the input grid. The
              underlying parameter grid is rendered as a warped net
              across Lab space — the direction each parameter pushes
              colour is then visible, not inferred.
            </p>
            <p className="mt-2 text-[color:var(--color-ink-muted)]">
              <strong>Variance captured</strong> ministats report how
              much of Lab variance PC1 / PC2 / PC3 explain. PC2 &lt; 3 %
              means the sweep is effectively 1-D — switch to the
              marginals below. <strong>ΔE radius</strong> draws a disk
              around the pinned dot; dots inside it are ΔE-neighbours
              (CIEDE2000) worth comparing.
            </p>
          </div>
        </div>
      </Section>

      <Divider />

      <Section title="Crosshair strips · marginals">
        <p className="mb-4 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
          The atlas and drift map show the full 2-D picture. The
          marginals project it onto each axis — the "shadow" of the test
          against one parameter at a time. Composed as an L so it's
          obvious they're projections of a 2-D test, not two unrelated
          1-D plots.
        </p>
        <div className="grid grid-cols-[150px_1fr] gap-4 items-start">
          <div className="h-[100px] rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden p-1.5">
            <VizCrosshair />
          </div>
          <div className="text-[12.5px] text-[color:var(--color-ink)] leading-relaxed">
            <p>
              Top strip = <strong>row-mean</strong> (varies with x);
              left strip = <strong>col-mean</strong> (varies with y).
              Clipping one axis means the other's strip recomputes as a
              mean over just that slice — "clip x to the middle third"
              tells you how y behaves there.
            </p>
            <p className="mt-2 text-[color:var(--color-ink-muted)]">
              Four draggable handles (two per axis) live on the strips.
              The <strong>Crop</strong> toggle in the section header
              collapses the dimmed clipped region so the active slice
              fills the panel — great for screenshots or for staring at
              the useful window without the noisy bookends.
            </p>
            <p className="mt-2 text-[color:var(--color-ink-muted)]">
              A deg-2 PC1 fit runs on each marginal; the{" "}
              <strong>residual ΔE</strong> cards in the rail use the
              same tone thresholds as the 1-axis page: &lt;1.5
              imperceptible, ~3 just noticeable, &gt;6 clearly off.
            </p>
          </div>
        </div>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Layout helpers                                                   */
/* ---------------------------------------------------------------- */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-8 px-4 font-mono text-[10.5px] font-semibold tracking-[0.14em] uppercase",
        "transition-colors",
        active
          ? "bg-[color:var(--color-ink)] text-[color:var(--color-surface)]"
          : "text-[color:var(--color-ink-muted)] hover:text-[color:var(--color-ink)] hover:bg-[color:var(--color-surface-elevated)]",
      )}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="px-6 py-5">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-3">
        <span
          className="h-px w-4 bg-[color:var(--color-border-strong)]"
          aria-hidden
        />
        {title}
      </div>
      {children}
    </section>
  );
}

function Divider() {
  return <MetalBar variant="soft" />;
}

function Pipeline() {
  return (
    <section className="px-6 py-5">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-3">
        <span
          className="h-px w-4 bg-[color:var(--color-border-strong)]"
          aria-hidden
        />
        The pipeline
      </div>
      <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-3.5">
        <div className="grid grid-cols-5 items-center gap-2">
          <Step icon={<PhotoGlyph />} label="Photo" detail="QR + ArUcos" />
          <Arrow />
          <Step icon={<LabGlyph />} label="Lab" detail="per-cell swatch" />
          <Arrow />
          <Step icon={<ProjGlyph />} label="Project" detail="1 scalar each" />
        </div>
        <div className="grid grid-cols-5 items-center gap-2 mt-3">
          <div />
          <div className="flex justify-center">
            <DownArrow />
          </div>
          <div />
          <div />
          <div />
        </div>
        <div className="grid grid-cols-5 items-center gap-2">
          <Step icon={<PredictGlyph />} label="Predict" detail="smooth curve" />
          <Arrow back />
          <Step icon={<FitGlyph />} label="Fit" detail="polynomial" />
          <div />
          <div />
        </div>
      </div>
    </section>
  );
}

function Step({
  icon,
  label,
  detail,
}: {
  icon: ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="h-9 w-9 rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border-strong)] flex items-center justify-center text-[color:var(--color-primary)]">
        {icon}
      </div>
      <div className="mt-1.5 font-mono text-[10.5px] font-semibold tracking-[0.08em] text-[color:var(--color-ink)]">
        {label}
      </div>
      <div className="font-mono text-[9.5px] tracking-[0.04em] text-[color:var(--color-ink-subtle)]">
        {detail}
      </div>
    </div>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <div className="flex items-center justify-center">
      <svg
        viewBox="0 0 40 12"
        className="w-full h-3"
        style={{ color: "var(--color-border-strong)" }}
      >
        <line
          x1={back ? 40 : 0}
          x2={back ? 0 : 40}
          y1={6}
          y2={6}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        <polyline
          points={back ? "5,2 1,6 5,10" : "35,2 39,6 35,10"}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}

function DownArrow() {
  return (
    <svg
      viewBox="0 0 12 24"
      className="h-5 w-3"
      style={{ color: "var(--color-border-strong)" }}
    >
      <line
        x1={6}
        x2={6}
        y1={0}
        y2={20}
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <polyline
        points="2,15 6,19 10,15"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
    </svg>
  );
}

function ProjRow({
  label,
  tag,
  viz,
  children,
}: {
  label: string;
  tag: string;
  viz: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-4 items-start">
      <div className="flex flex-col gap-1.5">
        <div className="h-[44px] rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] overflow-hidden p-1.5">
          {viz}
        </div>
        <div>
          <div className="font-mono text-[12px] font-semibold text-[color:var(--color-ink)] tabular-nums">
            {label}
          </div>
          <div className="font-mono text-[9.5px] tracking-[0.08em] uppercase text-[color:var(--color-ink-subtle)] leading-tight">
            {tag}
          </div>
        </div>
      </div>
      <div className="text-[12.5px] text-[color:var(--color-ink)] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function FitCard({
  label,
  sub,
  viz,
  text,
}: {
  label: string;
  sub: string;
  viz: ReactNode;
  text: string;
}) {
  return (
    <div className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-2.5">
      <div className="rounded-[4px] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] p-1.5">
        {viz}
      </div>
      <div className="mt-2 font-mono text-[11px] font-semibold text-[color:var(--color-ink)]">
        {label}
      </div>
      <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
        {sub}
      </div>
      <p className="mt-1 text-[11px] text-[color:var(--color-ink-muted)] leading-snug">
        {text}
      </p>
    </div>
  );
}

function MiniCard({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-4 py-3.5">
      <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)]">
        {kicker}
      </div>
      <div className="mt-0.5 text-[13px] font-semibold text-[color:var(--color-ink)] leading-tight">
        {title}
      </div>
      <p className="mt-1.5 text-[11.5px] text-[color:var(--color-ink-muted)] leading-relaxed">
        {body}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Mini-visualisations — hand-drawn-feeling SVGs keyed to each concept */
/* ---------------------------------------------------------------- */

// Shared rainbow palette we reuse in several vizes.
const SPECTRUM = ["#e45a3a", "#e7a63c", "#d6b85a", "#8ca84a", "#3fa27d", "#3f78a2", "#6b4caa", "#b04a7e"];

function VizPC1() {
  // Scatter-through-a-line: points sit roughly along a diagonal and a
  // dashed line is drawn through them, the "principal" axis.
  const pts = [
    [6, 30, 0],
    [14, 26, 1],
    [22, 22, 2],
    [30, 20, 3],
    [40, 16, 4],
    [50, 14, 5],
    [60, 10, 6],
    [72, 8, 7],
    [18, 30, 0],
    [34, 24, 3],
    [46, 18, 4],
    [58, 13, 6],
  ];
  return (
    <svg viewBox="0 0 80 36" className="w-full h-full">
      <line
        x1={4}
        y1={32}
        x2={76}
        y2={6}
        stroke="var(--color-secondary)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      {pts.map(([x, y, ci], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={1.8}
          fill={SPECTRUM[ci]}
          stroke="rgba(0,0,0,0.3)"
          strokeWidth={0.3}
        />
      ))}
    </svg>
  );
}

function VizL() {
  return (
    <svg viewBox="0 0 80 28" className="w-full h-full">
      <defs>
        <linearGradient id="l-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#0a0a0a" />
          <stop offset="100%" stopColor="#f5f2ed" />
        </linearGradient>
      </defs>
      <rect
        x={2}
        y={6}
        width={76}
        height={16}
        fill="url(#l-grad)"
        stroke="var(--color-border-strong)"
        strokeWidth={0.5}
        rx={2}
      />
      <text x={4} y={26} style={{ font: "7px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
        0
      </text>
      <text
        x={76}
        y={26}
        textAnchor="end"
        style={{ font: "7px var(--font-mono)", fill: "var(--color-ink-subtle)" }}
      >
        100
      </text>
    </svg>
  );
}

function VizC() {
  return (
    <svg viewBox="0 0 80 28" className="w-full h-full">
      <defs>
        <linearGradient id="c-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#9a8f85" />
          <stop offset="100%" stopColor="#d4341e" />
        </linearGradient>
      </defs>
      <rect
        x={2}
        y={6}
        width={76}
        height={16}
        fill="url(#c-grad)"
        stroke="var(--color-border-strong)"
        strokeWidth={0.5}
        rx={2}
      />
      <text x={4} y={26} style={{ font: "7px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
        grey
      </text>
      <text
        x={76}
        y={26}
        textAnchor="end"
        style={{ font: "7px var(--font-mono)", fill: "var(--color-ink-subtle)" }}
      >
        vivid
      </text>
    </svg>
  );
}

function VizHue() {
  // Rainbow strip.
  return (
    <svg viewBox="0 0 80 28" className="w-full h-full">
      <defs>
        <linearGradient id="hue-grad" x1="0" x2="1" y1="0" y2="0">
          {[
            "#e04a3a",
            "#e29a3a",
            "#dfc63a",
            "#6ea843",
            "#3ca88f",
            "#3c6fa8",
            "#7a4ca8",
            "#b54583",
            "#e04a3a",
          ].map((c, i, arr) => (
            <stop key={i} offset={`${(i / (arr.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <rect
        x={2}
        y={6}
        width={76}
        height={16}
        fill="url(#hue-grad)"
        stroke="var(--color-border-strong)"
        strokeWidth={0.5}
        rx={2}
      />
      <text x={4} y={26} style={{ font: "7px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
        0°
      </text>
      <text
        x={76}
        y={26}
        textAnchor="end"
        style={{ font: "7px var(--font-mono)", fill: "var(--color-ink-subtle)" }}
      >
        360°
      </text>
    </svg>
  );
}

function VizAb() {
  return (
    <svg viewBox="0 0 80 28" className="w-full h-full">
      <defs>
        <linearGradient id="a-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#2b8a4a" />
          <stop offset="50%" stopColor="#b9b6ae" />
          <stop offset="100%" stopColor="#c23a3f" />
        </linearGradient>
        <linearGradient id="b-grad" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#2d56a0" />
          <stop offset="50%" stopColor="#b9b6ae" />
          <stop offset="100%" stopColor="#d4b126" />
        </linearGradient>
      </defs>
      <rect
        x={2}
        y={3}
        width={76}
        height={9}
        fill="url(#a-grad)"
        stroke="var(--color-border-strong)"
        strokeWidth={0.4}
        rx={1.5}
      />
      <rect
        x={2}
        y={15}
        width={76}
        height={9}
        fill="url(#b-grad)"
        stroke="var(--color-border-strong)"
        strokeWidth={0.4}
        rx={1.5}
      />
      <text x={2} y={2.5} style={{ font: "6px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
        a*
      </text>
      <text x={2} y={14.5} style={{ font: "6px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
        b*
      </text>
    </svg>
  );
}

function VizDeltaE() {
  // Anchor swatch with concentric "distance" rings.
  return (
    <svg viewBox="0 0 80 36" className="w-full h-full">
      {[16, 12, 8].map((r, i) => (
        <circle
          key={r}
          cx={18}
          cy={18}
          r={r}
          fill="none"
          stroke="var(--color-border-strong)"
          strokeWidth={0.6}
          strokeDasharray={i === 0 ? "3 2" : undefined}
        />
      ))}
      <circle cx={18} cy={18} r={3.5} fill="#e04a3a" stroke="rgba(0,0,0,0.3)" strokeWidth={0.4} />
      {/* A few faraway samples */}
      <circle cx={38} cy={12} r={2.2} fill="#e7a63c" stroke="rgba(0,0,0,0.3)" strokeWidth={0.3} />
      <circle cx={48} cy={22} r={2.2} fill="#8ca84a" stroke="rgba(0,0,0,0.3)" strokeWidth={0.3} />
      <circle cx={58} cy={10} r={2.2} fill="#3fa27d" stroke="rgba(0,0,0,0.3)" strokeWidth={0.3} />
      <circle cx={68} cy={26} r={2.2} fill="#6b4caa" stroke="rgba(0,0,0,0.3)" strokeWidth={0.3} />
      <text
        x={18}
        y={34}
        textAnchor="middle"
        style={{ font: "6.5px var(--font-mono)", fill: "var(--color-ink-subtle)" }}
      >
        origin
      </text>
    </svg>
  );
}

function VizFit({ degree }: { degree: 0 | 1 | 2 | 3 }) {
  // Shared scatter points; draw different fit curve atop.
  const pts: [number, number][] = [
    [8, 46],
    [16, 42],
    [22, 36],
    [30, 32],
    [38, 26],
    [46, 22],
    [54, 18],
    [62, 20],
    [70, 26],
    [76, 32],
  ];
  const fitPath = (() => {
    if (degree === 0) return null;
    const xs = Array.from({ length: 40 }, (_, i) => 4 + (i / 39) * 76);
    const eval1 = (x: number) => 52 - 0.45 * x;
    const eval2 = (x: number) => 50 - 1.1 * x + 0.013 * x * x;
    const eval3 = (x: number) =>
      54 - 1.8 * x + 0.035 * x * x - 0.00032 * x * x * x;
    const f = degree === 1 ? eval1 : degree === 2 ? eval2 : eval3;
    const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${Math.max(4, Math.min(54, f(x))).toFixed(1)}`).join(" ");
    return d;
  })();
  return (
    <svg viewBox="0 0 84 58" className="w-full h-full">
      {/* baseline */}
      <line
        x1={4}
        y1={54}
        x2={80}
        y2={54}
        stroke="var(--color-border-strong)"
        strokeWidth={0.4}
      />
      {fitPath && (
        <path
          d={fitPath}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={1.2}
          strokeDasharray="3 2"
        />
      )}
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={1.8}
          fill={SPECTRUM[i % SPECTRUM.length]}
          stroke="rgba(0,0,0,0.25)"
          strokeWidth={0.3}
        />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* 2-axis page mini-vizes                                           */
/* ---------------------------------------------------------------- */

// A 4×4 micro-atlas with a hand-drawn iso-contour weaving through it.
function VizAtlasContours() {
  const cells: string[][] = [
    ["#cda876", "#c59f6c", "#a87c52", "#7e5237"],
    ["#d3a878", "#b88a5e", "#9e6b44", "#6e4630"],
    ["#c2a06e", "#a47a4d", "#8a5c38", "#4e3422"],
    ["#ad8456", "#8e6438", "#6d4628", "#3a2518"],
  ];
  const W = 150, H = 82, n = 4;
  const cw = W / n, ch = H / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {cells.map((row, r) =>
        row.map((c, col) => (
          <rect key={`${r}-${col}`} x={col * cw} y={r * ch} width={cw} height={ch} fill={c} />
        )),
      )}
      <path
        d="M 8 52 C 28 48 42 68 62 56 S 100 30 134 42"
        fill="none" stroke="var(--color-surface)" strokeOpacity={0.8} strokeWidth={3}
      />
      <path
        d="M 8 52 C 28 48 42 68 62 56 S 100 30 134 42"
        fill="none" stroke="var(--color-primary)" strokeWidth={1.5}
      />
      <path
        d="M 6 36 C 24 32 40 52 60 40 S 98 14 132 26"
        fill="none" stroke="var(--color-ink)" strokeOpacity={0.4} strokeWidth={0.8}
      />
      <path
        d="M 10 68 C 30 62 44 80 64 70 S 100 48 136 60"
        fill="none" stroke="var(--color-ink)" strokeOpacity={0.4} strokeWidth={0.8}
      />
    </svg>
  );
}

// PC1 × PC2 scatter with row (orange) + column (slate) threads.
function VizDriftThreads() {
  const W = 150, H = 82;
  const pts: { r: number; c: number; x: number; y: number; hex: string }[] = [
    { r: 0, c: 0, x: 24, y: 60, hex: "#7a4a2e" },
    { r: 0, c: 1, x: 54, y: 52, hex: "#a56b3f" },
    { r: 0, c: 2, x: 94, y: 44, hex: "#cd8f56" },
    { r: 1, c: 0, x: 30, y: 42, hex: "#6a8763" },
    { r: 1, c: 1, x: 62, y: 36, hex: "#8fa67d" },
    { r: 1, c: 2, x: 104, y: 30, hex: "#b9c099" },
    { r: 2, c: 0, x: 36, y: 22, hex: "#3e667d" },
    { r: 2, c: 1, x: 68, y: 18, hex: "#5a82a0" },
    { r: 2, c: 2, x: 112, y: 14, hex: "#7ca1c2" },
  ];
  const byRow = [0, 1, 2].map((r) => pts.filter((p) => p.r === r));
  const byCol = [0, 1, 2].map((c) => pts.filter((p) => p.c === c));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      <rect x={4} y={4} width={W - 8} height={H - 8} fill="none" stroke="var(--color-border)" strokeWidth={0.5} />
      {byRow.map((row, i) => (
        <path
          key={`r${i}`}
          d={`M ${row.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
          fill="none" stroke="var(--color-primary)" strokeOpacity={0.4} strokeWidth={0.8}
        />
      ))}
      {byCol.map((col, i) => (
        <path
          key={`c${i}`}
          d={`M ${col.map((p) => `${p.x} ${p.y}`).join(" L ")}`}
          fill="none" stroke="var(--color-secondary)" strokeOpacity={0.5} strokeWidth={0.8}
        />
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={p.hex} stroke="rgba(0,0,0,0.35)" strokeWidth={0.3} />
      ))}
    </svg>
  );
}

// L-shape: horizontal row-mean strip on top, vertical col-mean strip on
// the left, translucent mini-atlas in the middle, two clip ticks.
function VizCrosshair() {
  const W = 150, H = 82;
  const STRIP = 14;
  const topStripColors = ["#a47a52", "#b88960", "#c69a6e", "#d0a97a", "#d4b488", "#cfae82", "#c79e74", "#a67a52"];
  const sideStripColors = ["#73522e", "#88634a", "#a07c5e", "#b8976f"];
  const atlas: string[][] = [
    ["#d8c08e", "#d4b886", "#c9a874", "#b08a5a"],
    ["#c9b284", "#bea272", "#a88858", "#8a6a3e"],
    ["#a99168", "#987f54", "#80663a", "#604a26"],
    ["#7e6442", "#6c5234", "#543b24", "#382416"],
  ];
  const cw = (W - STRIP - 4) / atlas[0].length;
  const ch = (H - STRIP - 4) / atlas.length;
  const topCellW = (W - STRIP - 4) / topStripColors.length;
  const sideCellH = (H - STRIP - 4) / sideStripColors.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
      {topStripColors.map((c, i) => (
        <rect key={`t${i}`} x={STRIP + 2 + i * topCellW} y={2} width={topCellW} height={STRIP} fill={c} />
      ))}
      {sideStripColors.map((c, i) => (
        <rect key={`s${i}`} x={2} y={STRIP + 2 + i * sideCellH} width={STRIP} height={sideCellH} fill={c} />
      ))}
      {atlas.map((row, r) =>
        row.map((c, col) => (
          <rect
            key={`${r}-${col}`}
            x={STRIP + 2 + col * cw}
            y={STRIP + 2 + r * ch}
            width={cw}
            height={ch}
            fill={c}
            opacity={0.55}
          />
        )),
      )}
      <rect
        x={STRIP + 2}
        y={STRIP + 2}
        width={W - STRIP - 4}
        height={H - STRIP - 4}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={0.4}
      />
      <line x1={STRIP + 2 + cw * 1} y1={1} x2={STRIP + 2 + cw * 1} y2={STRIP + 3} stroke="var(--color-ink)" strokeWidth={1.2} />
      <line x1={STRIP + 2 + cw * 3} y1={1} x2={STRIP + 2 + cw * 3} y2={STRIP + 3} stroke="var(--color-ink)" strokeWidth={1.2} />
    </svg>
  );
}

/* ---------------------------------------------------------------- */
/* Pipeline step glyphs                                             */
/* ---------------------------------------------------------------- */

function PhotoGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x={3} y={5} width={14} height={11} rx={1.5} />
      <circle cx={10} cy={11} r={3} />
      <line x1={13} y1={5} x2={13} y2={3.5} />
      <line x1={15} y1={5} x2={15} y2={3.5} />
    </svg>
  );
}

function LabGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx={7} cy={7} r={2.2} />
      <circle cx={13} cy={10} r={2.2} />
      <circle cx={9} cy={13} r={2.2} />
      <circle cx={15} cy={15} r={2.2} />
    </svg>
  );
}

function ProjGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <line x1={3} y1={10} x2={17} y2={10} />
      <circle cx={5} cy={10} r={1.2} fill="currentColor" />
      <circle cx={9} cy={10} r={1.2} fill="currentColor" />
      <circle cx={13} cy={10} r={1.2} fill="currentColor" />
      <circle cx={17} cy={10} r={1.2} fill="currentColor" />
      <line x1={5} y1={6} x2={5} y2={10} strokeDasharray="1 1" />
      <line x1={9} y1={5} x2={9} y2={10} strokeDasharray="1 1" />
      <line x1={13} y1={7} x2={13} y2={10} strokeDasharray="1 1" />
      <line x1={17} y1={4} x2={17} y2={10} strokeDasharray="1 1" />
    </svg>
  );
}

function FitGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M 3 15 Q 10 3 17 15" />
      <circle cx={5} cy={13} r={1} fill="currentColor" />
      <circle cx={9} cy={7} r={1} fill="currentColor" />
      <circle cx={13} cy={8} r={1} fill="currentColor" />
      <circle cx={16} cy={14} r={1} fill="currentColor" />
    </svg>
  );
}

function PredictGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x={3} y={6} width={14} height={8} rx={1.2} />
      <rect x={3} y={6} width={3.5} height={8} fill="currentColor" opacity={0.35} stroke="none" />
      <rect x={6.5} y={6} width={3.5} height={8} fill="currentColor" opacity={0.55} stroke="none" />
      <rect x={10} y={6} width={3.5} height={8} fill="currentColor" opacity={0.75} stroke="none" />
      <rect x={13.5} y={6} width={3.5} height={8} fill="currentColor" opacity={1} stroke="none" />
    </svg>
  );
}
