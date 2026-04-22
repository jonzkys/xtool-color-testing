import type { ReactNode } from "react";
import { X } from "lucide-react";
import {
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  MetalBar,
} from "../ui";
import { DialogClose } from "@radix-ui/react-dialog";

/**
 * The field manual. Opens from the ? button on the Spectrum page.
 * Styled like a lab notebook — tick-marked section rules, monospace
 * caption labels, hand-drawn-feeling mini diagrams for every concept.
 */
export function SpectrumAbout({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
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
            How a burned test becomes a plot
          </h2>
          <p className="mt-1 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed max-w-[58ch]">
            The Spectrum page collapses three colour channels into one
            number per swatch, then lets you fit a curve to it. Pick the{" "}
            <strong className="text-[color:var(--color-ink)]">projection</strong>{" "}
            (how to collapse) and the{" "}
            <strong className="text-[color:var(--color-ink)]">fit degree</strong>{" "}
            (how much curvature) — different choices tell different
            stories about the same sweep.
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

        {/* Body scrolls independently so the masthead stays visible. */}
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
          </Section>

          <Divider />

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

          <div className="h-4" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- */
/* Layout helpers                                                   */
/* ---------------------------------------------------------------- */

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
