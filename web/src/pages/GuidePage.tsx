/**
 * Getting Started — "blueprint poster" direction.
 *
 * Five self-contained panels stacked vertically. Each panel has a
 * 2°-tilted MetalBar "spine" along the top carrying an oversized
 * orange roman numeral + section title. Floating circular compass nav
 * lives bottom-right, expanding on hover into a radial list of all
 * five sections. Everything here is static content + hand-drawn SVG
 * diagrams in the Workshop Instrument vocabulary (mono-caps kickers,
 * slate ink, primary orange accent) — same aesthetic as the Spectrum
 * field manual, scaled up to long-form.
 *
 * Screenshots: the ``Figure`` primitive renders a matte placeholder
 * when ``src`` is omitted so the whole guide stays readable before
 * real art lands. Pin overlays are data-driven ({xPct, yPct, label,
 * body}) so the SVG re-projects responsively.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Camera, Compass, Layers, Palette, Upload } from "lucide-react";
import { useRoute } from "../router";
import { cn, MetalBar, PageContainer } from "../ui";

/* ========================================================================
 * Section metadata
 * ====================================================================== */

type SectionId = "library" | "test" | "ingest" | "spectrum" | "layers";

interface SectionMeta {
  id: SectionId;
  roman: string;      // I, II, III, IV, V
  title: string;
  eyebrow: string;    // e.g. "the groundwork"
  minutes: number;
  icon: typeof Palette;
}

const SECTIONS: SectionMeta[] = [
  { id: "library",  roman: "I",   title: "Material & preset",          eyebrow: "the groundwork",        minutes: 2, icon: Palette },
  { id: "test",     roman: "II",  title: "Generate a test",            eyebrow: "the workshop hour",     minutes: 4, icon: Camera  },
  { id: "ingest",   roman: "III", title: "Upload & ingest a result",    eyebrow: "photo to palette",      minutes: 3, icon: Upload  },
  { id: "spectrum", roman: "IV",  title: "Spectrum (briefly)",          eyebrow: "parameter playground",  minutes: 1, icon: Compass },
  { id: "layers",   roman: "V",   title: "SVG layers & raster tracing", eyebrow: "the real work",        minutes: 6, icon: Layers  },
];

/* ========================================================================
 * Page
 * ====================================================================== */

export function GuidePage() {
  const [, navigate] = useRoute();
  const [active, setActive] = useState<SectionId>("library");

  // Spy on which section is in view (Intersection Observer; thresholds
  // picked so the active state flips when the section crosses the top
  // third of the viewport — smoother than waiting for it to hit centre).
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    for (const s of SECTIONS) {
      const el = document.getElementById(`guide-${s.id}`);
      if (!el) continue;
      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              setActive(s.id);
              break;
            }
          }
        },
        { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const jump = (id: SectionId) => {
    const el = document.getElementById(`guide-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative">
      <PageContainer className="py-10 max-w-[1200px]">
        <Masthead />
        <div className="flex flex-col">
          {SECTIONS.map((s, i) => (
            <Panel
              key={s.id}
              meta={s}
              /* Alternate the spine tilt direction so adjacent panels
               * read as stacked plates, not a repeating pattern. */
              tiltDeg={i % 2 === 0 ? -1.6 : 1.6}
            >
              {s.id === "library"  && <LibrarySection />}
              {s.id === "test"     && <TestSection onOpenTests={() => navigate({ name: "tests" })} />}
              {s.id === "ingest"   && <IngestSection />}
              {s.id === "spectrum" && <SpectrumBriefSection onOpenSpectrum={() => navigate({ name: "spectrum" })} />}
              {s.id === "layers"   && <LayersSection onOpenLayers={() => navigate({ name: "svg-layers" })} />}
            </Panel>
          ))}
        </div>
      </PageContainer>
      <CompassNav active={active} onJump={jump} />
    </div>
  );
}

/* ========================================================================
 * Masthead + Compass + Panel chrome
 * ====================================================================== */

function Masthead() {
  return (
    <header className="mb-10">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-3">
        <span className="h-px w-5 bg-[color:var(--color-border-strong)]" aria-hidden />
        Field manual · vol. 0 — getting started
      </div>
      <h1 className="text-[36px] font-semibold leading-[1.1] text-[color:var(--color-ink)] max-w-[22ch]">
        A <em className="not-italic text-[color:var(--color-primary)]">slow walk</em> through the instrument.
      </h1>
      <p className="mt-3 text-[16px] leading-[1.6] text-[color:var(--color-ink-muted)] max-w-[62ch]">
        xcs-gen is a workbench for finding, cataloguing and reusing
        laser-engraved colours. This guide walks you from a blank
        library to a full colour-matched engraving in five panels —
        roughly sixteen minutes end-to-end.
      </p>
      <div className="mt-4">
        <MetalBar />
      </div>
      <TocStrip />
    </header>
  );
}

function TocStrip() {
  return (
    <ol className="mt-5 grid grid-cols-5 gap-3 text-left">
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        return (
          <li key={s.id}>
            <a
              href={`#guide-${s.id}`}
              className={cn(
                "group block rounded-[8px] border border-[color:var(--color-border)]",
                "bg-[color:var(--color-surface-elevated)] px-3 py-2.5",
                "hover:border-[color:var(--color-primary)]/40",
                "hover:bg-[color:var(--color-primary-tint)]/30",
                "transition-colors",
              )}
            >
              <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
                <Icon className="h-3 w-3" strokeWidth={1.75} />
                <span>{s.roman}</span>
                <span className="ml-auto tabular-nums opacity-70">{s.minutes}m</span>
              </div>
              <div className="mt-1 text-[13px] font-semibold leading-tight text-[color:var(--color-ink)]">
                {s.title}
              </div>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({
  meta,
  tiltDeg,
  children,
}: {
  meta: SectionMeta;
  tiltDeg: number;
  children: ReactNode;
}) {
  return (
    <section
      id={`guide-${meta.id}`}
      className="relative pt-10 pb-14"
      style={{ scrollMarginTop: "24px" }}
    >
      {/* Diagonal spine with an oversized orange numeral and the title.
          The spine is a thin double-line: a MetalBar at the top as a
          physical divider, + a second very-faint bar slightly below
          creating a "blueprint draw" double-stroke. The whole group
          is rotated by ``tiltDeg`` relative to the page. */}
      <div
        className="relative"
        style={{
          transform: `rotate(${tiltDeg}deg)`,
          transformOrigin: "left center",
        }}
      >
        <MetalBar />
      </div>

      <div className="relative mt-5 flex items-start gap-5">
        <span
          aria-hidden
          className="font-mono font-light text-[112px] leading-[0.85] tracking-[-0.04em] shrink-0"
          style={{
            color: "transparent",
            WebkitTextStroke: "1px var(--color-border-strong)",
          }}
        >
          {meta.roman}
        </span>
        <div className="flex-1 min-w-0 pt-3">
          <div className="inline-flex items-center gap-2 font-mono text-[10.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-primary)] mb-1.5">
            <span className="h-px w-4 bg-[color:var(--color-primary)]/70" aria-hidden />
            Section · {meta.roman}
          </div>
          <h2 className="text-[28px] font-semibold leading-[1.15] text-[color:var(--color-ink)]">
            {meta.title}
          </h2>
          <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px] tracking-[0.12em] uppercase text-[color:var(--color-ink-subtle)]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-primary)]"
            />
            <span>{meta.minutes} min · {meta.eyebrow}</span>
          </div>
        </div>
      </div>

      <div className="mt-7">{children}</div>
    </section>
  );
}

/* ------------------------- Compass nav ------------------------------- */

function CompassNav({
  active,
  onJump,
}: {
  active: SectionId;
  onJump: (id: SectionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeIdx = SECTIONS.findIndex((s) => s.id === active);
  const activeMeta = SECTIONS[activeIdx];
  const counterRef = useRef<HTMLSpanElement | null>(null);

  return (
    <div
      className="fixed bottom-6 right-6 z-30 flex flex-col items-end gap-3"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Expanded radial list */}
      <div
        className={cn(
          "flex flex-col items-stretch gap-1.5 transition-all duration-200",
          open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-2 pointer-events-none",
        )}
      >
        {SECTIONS.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onJump(s.id);
                setOpen(false);
              }}
              className={cn(
                "group flex items-center gap-3 h-9 pl-2.5 pr-4 rounded-full",
                "border text-left",
                "shadow-[0_6px_14px_-6px_rgba(24,24,27,0.25)]",
                isActive
                  ? "border-[color:var(--color-primary)] bg-[color:var(--color-primary)] text-white"
                  : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink)] hover:border-[color:var(--color-primary)]/50",
              )}
            >
              <span
                className={cn(
                  "font-mono font-semibold text-[12px] tabular-nums",
                  isActive ? "text-white" : "text-[color:var(--color-ink-subtle)]",
                )}
              >
                {s.roman}
              </span>
              <span className="text-[12.5px] font-medium whitespace-nowrap">
                {s.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Compass puck */}
      <div className="flex items-center gap-2">
        <span
          ref={counterRef}
          className="font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)] bg-[color:var(--color-surface-elevated)] border border-[color:var(--color-border)] px-2 py-0.5 rounded-full"
          aria-hidden
        >
          {activeIdx + 1} / {SECTIONS.length}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="Guide navigation"
          className={cn(
            "relative flex h-14 w-14 items-center justify-center rounded-full",
            "border border-[color:var(--color-primary)]",
            "bg-[color:var(--color-primary)] text-white",
            "shadow-[0_10px_24px_-8px_rgba(184,65,14,0.5)]",
            "transition-transform hover:scale-[1.04]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60 focus-visible:ring-offset-2",
          )}
        >
          <span className="font-mono text-[22px] font-semibold leading-none">
            {activeMeta.roman}
          </span>
          <span className="sr-only">{activeMeta.title}</span>
          {/* A thin compass ring — rotates slowly as a quiet lived-in
              touch; disabled if the user prefers reduced motion. */}
          <span
            aria-hidden
            className="absolute inset-[4px] rounded-full border border-white/30 motion-safe:animate-[spin_18s_linear_infinite]"
            style={{
              maskImage:
                "conic-gradient(from 0deg, #000 0deg, #000 200deg, transparent 240deg, #000 320deg)",
            }}
          />
        </button>
      </div>
    </div>
  );
}

/* ========================================================================
 * Figure + PinnedScreenshot primitives
 * ====================================================================== */

interface Pin {
  /** 0–100 — percentage from the left edge of the figure's inner area. */
  xPct: number;
  /** 0–100 — percentage from the top edge. */
  yPct: number;
  /** Short numeric tag rendered inside the pin dot. Mostly "1", "2"… */
  tag: string | number;
  /** Caption line rendered below the image. */
  caption: string;
}

function Figure({
  src,
  alt,
  label,
  pins,
  aspect = "16 / 10",
  compact,
}: {
  src?: string;
  alt?: string;
  label: string; // "FIG. 2.3 — THE TEST EDITOR, FILLED"
  pins?: Pin[];
  aspect?: string;
  compact?: boolean;
}) {
  return (
    <figure
      className={cn(
        "rounded-[10px] border border-[color:var(--color-border-strong)]",
        "bg-[color:var(--color-surface-elevated)] p-3",
        compact ? "p-2" : "p-3",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[6px]",
          "border border-[color:var(--color-border)]",
          src ? "bg-[color:var(--color-surface)]" : "bg-transparent",
        )}
        style={{ aspectRatio: aspect }}
      >
        {src ? (
          <img
            src={src}
            alt={alt || label}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <Placeholder label={label} />
        )}
        {pins?.map((p, i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2",
              "flex h-6 w-6 items-center justify-center rounded-full",
              "bg-[color:var(--color-primary)] text-white",
              "font-mono text-[11px] font-bold tabular-nums",
              "ring-2 ring-white shadow-[0_4px_10px_-2px_rgba(184,65,14,0.55)]",
            )}
            style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
          >
            {p.tag}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-[10px] font-semibold tracking-[0.18em] uppercase text-[color:var(--color-ink-subtle)]">
          {label}
        </span>
      </figcaption>
      {pins && pins.length > 0 && (
        <ol className="mt-2 grid grid-cols-1 gap-1.5 text-[11.5px] text-[color:var(--color-ink-muted)]">
          {pins.map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-[1px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                  "bg-[color:var(--color-primary)] text-white",
                  "font-mono text-[9px] font-bold tabular-nums",
                )}
              >
                {p.tag}
              </span>
              <span className="leading-[1.5]">{p.caption}</span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
      {/* Hatched backdrop — announces "this is a placeholder", not a
          bug. Same 45°-hatch pattern used elsewhere in the app for
          excluded regions. */}
      <svg
        viewBox="0 0 20 20"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full opacity-40"
        aria-hidden
      >
        <defs>
          <pattern id="guide-placeholder-hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="2" fill="var(--color-surface-elevated)" />
            <line x1="0" y1="0" x2="0" y2="2" stroke="var(--color-border)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="20" height="20" fill="url(#guide-placeholder-hatch)" />
      </svg>
      <div className="relative z-10 inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        {label}
      </div>
      <p className="relative z-10 font-mono text-[10.5px] tabular-nums text-[color:var(--color-ink-muted)]">
        screenshot pending
      </p>
    </div>
  );
}

/* ========================================================================
 * Callout boxes
 * ====================================================================== */

function Callout({
  kicker,
  tone = "note",
  children,
}: {
  kicker: string;
  tone?: "note" | "warn" | "tip";
  children: ReactNode;
}) {
  const tint =
    tone === "warn"
      ? "border-[color:var(--color-destructive)]/35 bg-[color:var(--color-destructive-tint)]"
      : tone === "tip"
        ? "border-[color:var(--color-secondary)]/40 bg-[color:var(--color-secondary-tint)]"
        : "border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)]";
  const ink =
    tone === "warn"
      ? "text-[color:var(--color-destructive)]"
      : tone === "tip"
        ? "text-[color:var(--color-secondary)]"
        : "text-[color:var(--color-primary)]";
  return (
    <div className={cn("rounded-[8px] border px-4 py-3", tint)}>
      <div className={cn("font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase mb-1", ink)}>
        {kicker}
      </div>
      <div className="text-[12.5px] leading-relaxed text-[color:var(--color-ink)]">
        {children}
      </div>
    </div>
  );
}

/* ========================================================================
 * Prose / layout helpers
 * ====================================================================== */

function TwoCol({
  prose,
  aside,
}: {
  prose: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-8 items-start">
      <div className="prose-guide">{prose}</div>
      <div className="flex flex-col gap-4 self-start sticky top-8">
        {aside}
      </div>
    </div>
  );
}

function Para({ children }: { children: ReactNode }) {
  return (
    <p className="text-[14.5px] leading-[1.7] text-[color:var(--color-ink)] [&+p]:mt-3 [&+*]:mt-4">
      {children}
    </p>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 mb-2 inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
      <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
      {children}
    </div>
  );
}

function CtaButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mt-4 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full",
        "border border-[color:var(--color-primary)]",
        "bg-[color:var(--color-primary)] text-white",
        "font-mono text-[11px] font-semibold tracking-[0.14em] uppercase",
        "hover:bg-[color:var(--color-primary)]/90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
        "transition-colors",
      )}
    >
      {children}
    </button>
  );
}

/* ========================================================================
 * SECTION I — Material & preset
 * ====================================================================== */

function LibrarySection() {
  return (
    <TwoCol
      prose={
        <>
          <Para>
            Everything in xcs-gen is attached to a{" "}
            <strong>material</strong> — the physical substrate you're
            burning on, e.g. "Stainless Steel (300-series)" or
            "Anodised Aluminium (black)". Tests, palette swatches, and
            SVG-layer presets all live under exactly one material, so
            colour matches from one material never accidentally
            pollute another.
          </Para>
          <Para>
            A <strong>preset</strong> is a named bundle of{" "}
            <em>processing parameters</em> (power, speed, frequency,
            lines/cm, passes, pulse width) that belongs to a material.
            When you generate a test, the preset seeds the "base
            params" — the fixed values on every cell — so you don't
            have to type the same eight numbers every time.
          </Para>
          <Kicker>What you do here</Kicker>
          <Para>
            Open the Library tab, create a material, then add at least
            one preset for it. Mark one preset as{" "}
            <strong>default</strong> for that material — new tests and
            new SVG layers will seed from it.
          </Para>
          <Callout kicker="tip" tone="tip">
            One preset per known-good recipe. If you discover a great
            combination while tuning a test, come back here and save
            it as a preset so the next job starts from it.
          </Callout>
        </>
      }
      aside={
        <>
          <Figure
            src="/guide/fig-1-1-library.png"
            label="FIG. 1.1 — LIBRARY · MATERIALS LIST"
            aspect="16 / 10"
            pins={[
              { xPct: 84, yPct: 10, tag: 1, caption: "New material — name, visibility, notes." },
              { xPct: 18, yPct: 28, tag: 2, caption: "Materials you own; click to expand presets." },
              { xPct: 80, yPct: 22, tag: 3, caption: "+ Preset adds a named parameter bundle." },
              { xPct: 46, yPct: 30, tag: 4, caption: "Default preset — seeds new tests + layers." },
            ]}
          />
          <MaterialPresetGlyph />
        </>
      }
    />
  );
}

/**
 * Tiny hand-drawn glyph for the Library section — a stylised steel
 * tag with a swatch strip, sitting behind a "preset card" with knobs.
 * A quick semantic anchor before the screenshot arrives.
 */
function MaterialPresetGlyph() {
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
      <div className="inline-flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-2">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Mental model
      </div>
      <svg viewBox="0 0 260 110" className="w-full h-auto">
        {/* Substrate tag */}
        <rect x={12} y={18} width={130} height={78} rx={6}
          fill="var(--color-surface)"
          stroke="var(--color-border-strong)" strokeWidth={1}
        />
        <text x={18} y={32} style={{ font: "bold 8.5px var(--font-mono)", fill: "var(--color-ink-subtle)", letterSpacing: "0.12em" }}>
          MATERIAL
        </text>
        {/* Swatch strip on the tag */}
        <rect x={18} y={40} width={20} height={14} fill="#c9a16a" />
        <rect x={38} y={40} width={20} height={14} fill="#9a6d3f" />
        <rect x={58} y={40} width={20} height={14} fill="#68482a" />
        <rect x={78} y={40} width={20} height={14} fill="#412b1b" />
        <rect x={98} y={40} width={20} height={14} fill="#241913" />
        <rect x={18} y={54} width={100} height={0.8} fill="var(--color-border)" />
        <text x={18} y={68} style={{ font: "6.5px var(--font-mono)", fill: "var(--color-ink-muted)" }}>
          stainless · 300-series
        </text>

        {/* Preset card, overlapping */}
        <rect x={110} y={40} width={135} height={62} rx={6}
          fill="var(--color-surface-elevated)"
          stroke="var(--color-primary)" strokeWidth={1.2}
        />
        <text x={118} y={54} style={{ font: "bold 8px var(--font-mono)", fill: "var(--color-primary)", letterSpacing: "0.12em" }}>
          PRESET
        </text>
        {/* Fake knobs */}
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${120 + i * 28}, 72)`}>
            <circle r={7} fill="none" stroke="var(--color-ink-subtle)" strokeWidth={0.8} />
            <line x1={0} y1={-5} x2={i % 2 === 0 ? 3 : -3} y2={-2} stroke="var(--color-ink)" strokeWidth={1.2} strokeLinecap="round" />
          </g>
        ))}
        <text x={118} y={96} style={{ font: "6.5px var(--font-mono)", fill: "var(--color-ink-muted)" }}>
          power · speed · f · lines/cm · ppw · pass
        </text>
      </svg>
    </div>
  );
}

/* ========================================================================
 * SECTION II — Generate a test
 * ====================================================================== */

function TestSection({ onOpenTests }: { onOpenTests: () => void }) {
  return (
    <>
      <TwoCol
        prose={
          <>
            <Para>
              A <strong>test</strong> is a grid of laser burns that
              sweeps one or two parameters across a range. You specify
              the parameter (e.g. speed 500 → 3000, 30 steps) and
              xcs-gen emits an <code>.xcs</code> file you burn on your
              machine. Every cell carries a sampling target the
              ingestion pipeline reads back after you photograph the
              tag.
            </Para>
            <Para>
              Head to Tests → New, pick your material, then fill the
              editor. The diagram on the right shows how the knobs fit
              together.
            </Para>
            <Kicker>Options, explained</Kicker>
            <Para>
              <strong>X-axis parameter</strong> is the one that varies
              left-to-right on the burned grid. <strong>Y-axis
              parameter</strong> is optional: leave it unset for a 1-D
              sweep, or pick a second parameter for a 2-D test (each
              row becomes a y-value).
            </Para>
            <Para>
              <strong>x_steps / y_steps</strong> — how many cells
              along each axis. For pulse-width sweeps the cells snap
              to the F2 Ultra's preset list (2, 4, 6, 9, …500); the
              editor warns if you ask for more steps than the allowed
              values in range.
            </Para>
            <Para>
              <strong>rows</strong> — for 1-D tests only, wraps a long
              sweep across multiple rows so it fits a smaller tag.{" "}
              <strong>gap_mm</strong> is the space between cells.{" "}
              <strong>square_cells</strong> forces each cell to be
              square regardless of the total width — good for uniform
              photos.
            </Para>
            <Para>
              <strong>cell_shape</strong> — rectangles by default.
              Circles for when you want an inscribed-disc engrave
              (useful on curved tags).{" "}
              <strong>angle_mode</strong> — fixed-angle sweep by
              default; "crosshatch" alternates the scan angle between
              passes if you've set passes &gt; 1.
            </Para>
            <Para>
              <strong>Registration</strong> — on by default. Emits a
              QR code (top-left) and three ArUco markers at the other
              corners so we can un-warp any photo of the burned tag
              and sample the right cell. Leave this on unless you have
              a very good reason.
            </Para>
            <Kicker>Generate, burn, photograph</Kicker>
            <Para>
              When the editor is filled, press{" "}
              <strong>Generate .xcs</strong>. You get a single file to
              drop into XCS Studio, burn, then photograph the result.
              That photo is what Section III picks back up.
            </Para>
            <Callout kicker="retest counter" tone="tip">
              Re-burning the same test? Hit{" "}
              <strong>Retest</strong> before you regenerate — the
              counter bumps and the new QR stamps the retest index, so
              the variability view can tell the runs apart instead of
              mashing them into one average.
            </Callout>
            <CtaButton onClick={onOpenTests}>Open the Tests page →</CtaButton>
          </>
        }
        aside={
          <>
            <Figure
              src="/guide/fig-2-1-test-editor.png"
              label="FIG. 2.1 — TEST EDITOR, FILLED"
              aspect="16 / 10"
              pins={[
                { xPct: 16, yPct: 30, tag: 1, caption: "X-axis picker + range + step count." },
                { xPct: 16, yPct: 44, tag: 2, caption: "Optional Y-axis — unlocks a 2-D grid." },
                { xPct: 16, yPct: 60, tag: 3, caption: "Layout: width / height / gap / rows." },
                { xPct: 51, yPct: 40, tag: 4, caption: "Live preview with QR + ArUco markers baked in." },
                { xPct: 63, yPct: 9,  tag: 5, caption: "Generate .xcs — retest chip shows the next burn index." },
              ]}
            />
            <ParamDiagram />
            <Figure
              src="/guide/fig-3-2-ingest-palette.png"
              label="FIG. 2.2 — AVERAGED SWATCHES + INGEST"
              aspect="16 / 10"
              pins={[
                { xPct: 78, yPct: 52, tag: 1, caption: "Averaged swatches grid — n × σ per cell." },
                { xPct: 82, yPct: 76, tag: 2, caption: "Ingest to palette — averaged / from specific / replace." },
              ]}
            />
          </>
        }
      />
    </>
  );
}

/** `ParamDiagram` — the single most valuable hand-drawn viz in the
 *  guide. Shows a 4×3 grid of cells (one cell labelled) with x_min /
 *  x_max brackets along the top, a row-wrap indicator on the right,
 *  gap arrows between cells, and a tiny QR glyph in the corner. */
function ParamDiagram() {
  const cellW = 42;
  const cellH = 34;
  const pad = 40;
  const rows = 3;
  const cols = 4;
  const gap = 4;

  const w = pad + cols * (cellW + gap) + pad + 20;
  const h = pad + rows * (cellH + gap) + pad;
  // Rainbow-ish palette for the cells to suggest "a sweep".
  const palette = [
    "#b26a1c", "#a8532a", "#934d3d", "#7d4b4f",
    "#6a5a5a", "#547063", "#3e7e68", "#3c8a74",
    "#3e8e87", "#4a8b93", "#5e86a0", "#74809f",
  ];

  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
      <div className="inline-flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-2">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Anatomy of a test grid
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto">
        {/* Registration QR glyph, top-left of the implied tag area. */}
        <g transform={`translate(${pad - 26}, ${pad - 26})`}>
          <rect width={14} height={14} fill="var(--color-ink)" />
          <rect x={2} y={2} width={10} height={10} fill="var(--color-surface)" />
          <rect x={4} y={4} width={6} height={6} fill="var(--color-ink)" />
          <text x={-4} y={20} style={{ font: "6px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>QR</text>
        </g>

        {/* ArUco corner (tiny square), top-right of the grid area. */}
        <g transform={`translate(${pad + cols * (cellW + gap) - gap + 8}, ${pad - 18})`}>
          <rect width={8} height={8} fill="var(--color-ink)" />
          <text x={12} y={6} style={{ font: "6px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>ArUco</text>
        </g>

        {/* Cells */}
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const x = pad + c * (cellW + gap);
            const y = pad + r * (cellH + gap);
            const idx = r * cols + c;
            const colour = palette[idx % palette.length];
            const labeled = r === 1 && c === 1;
            return (
              <g key={`${r}-${c}`}>
                <rect x={x} y={y} width={cellW} height={cellH} rx={2} fill={colour} opacity={0.85} />
                {labeled && (
                  <g>
                    <rect x={x} y={y} width={cellW} height={cellH} rx={2} fill="none" stroke="var(--color-primary)" strokeWidth={1.5} />
                    <text x={x + cellW / 2} y={y + cellH + 10} textAnchor="middle" style={{ font: "bold 6.5px var(--font-mono)", fill: "var(--color-primary)" }}>
                      cell
                    </text>
                  </g>
                )}
              </g>
            );
          }),
        )}

        {/* Gap arrows — between col 0 and col 1 */}
        <g transform={`translate(${pad + cellW}, ${pad + cellH / 2})`}>
          <line x1={0} y1={0} x2={gap} y2={0} stroke="var(--color-ink-subtle)" strokeWidth={0.7} />
          <text x={gap / 2} y={-4} textAnchor="middle" style={{ font: "5.5px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
            gap
          </text>
        </g>

        {/* X-axis bracket at the top */}
        {(() => {
          const y0 = pad - 14;
          const x0 = pad;
          const xN = pad + cols * (cellW + gap) - gap;
          return (
            <g>
              <line x1={x0} y1={y0} x2={xN} y2={y0} stroke="var(--color-ink)" strokeWidth={1} />
              <line x1={x0} y1={y0 - 4} x2={x0} y2={y0 + 4} stroke="var(--color-ink)" strokeWidth={1} />
              <line x1={xN} y1={y0 - 4} x2={xN} y2={y0 + 4} stroke="var(--color-ink)" strokeWidth={1} />
              <text x={x0 - 2} y={y0 - 6} textAnchor="end" style={{ font: "bold 7px var(--font-mono)", fill: "var(--color-ink)" }}>x_min</text>
              <text x={xN + 2} y={y0 - 6} style={{ font: "bold 7px var(--font-mono)", fill: "var(--color-ink)" }}>x_max</text>
              <text x={(x0 + xN) / 2} y={y0 - 6} textAnchor="middle" style={{ font: "6px var(--font-mono)", fill: "var(--color-ink-subtle)", letterSpacing: "0.12em" }}>
                X_STEPS · 4
              </text>
            </g>
          );
        })()}

        {/* Row-wrap hint on the right */}
        {(() => {
          const xR = pad + cols * (cellW + gap) + 4;
          const yTop = pad + 2;
          const yBot = pad + rows * (cellH + gap) - gap - 2;
          return (
            <g>
              <line x1={xR} y1={yTop} x2={xR} y2={yBot} stroke="var(--color-primary)" strokeWidth={1} strokeDasharray="2 2" />
              <text x={xR + 4} y={yTop + 6} style={{ font: "bold 6.5px var(--font-mono)", fill: "var(--color-primary)" }}>rows</text>
              <text x={xR + 4} y={yTop + 14} style={{ font: "6px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>· 3</text>
            </g>
          );
        })()}

        {/* Y-axis bracket on the left */}
        {(() => {
          const xL = pad - 10;
          const yTop = pad;
          const yBot = pad + rows * (cellH + gap) - gap;
          return (
            <g>
              <line x1={xL} y1={yTop} x2={xL} y2={yBot} stroke="var(--color-ink)" strokeWidth={1} />
              <line x1={xL - 4} y1={yTop} x2={xL + 4} y2={yTop} stroke="var(--color-ink)" strokeWidth={1} />
              <line x1={xL - 4} y1={yBot} x2={xL + 4} y2={yBot} stroke="var(--color-ink)" strokeWidth={1} />
              <text x={xL - 14} y={(yTop + yBot) / 2} textAnchor="middle" transform={`rotate(-90 ${xL - 14} ${(yTop + yBot) / 2})`} style={{ font: "6px var(--font-mono)", fill: "var(--color-ink-subtle)", letterSpacing: "0.12em" }}>
                Y_STEPS (OR ROWS)
              </text>
            </g>
          );
        })()}

        {/* Footnote */}
        <text x={pad} y={h - 10} style={{ font: "6.5px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
          QR + 3× ArUcos at the corners → ingest un-warps the photo back into this grid.
        </text>
      </svg>
    </div>
  );
}

/* ========================================================================
 * SECTION III — Upload & ingest
 * ====================================================================== */

function IngestSection() {
  return (
    <TwoCol
      prose={
        <>
          <Para>
            Once you've burned the test and photographed it, uploading
            is one click. The ingestion pipeline decodes the QR, finds
            the ArUco markers, un-warps the photo into a flat
            rectangle the size of the burn area, samples every cell's
            centre, and stores the measured colours on the result.
          </Para>
          <Para>
            Use the <strong>Upload</strong> button in the top-right
            chrome, or drop a photo onto the Tests list. Auto-matching
            reads the QR so you don't have to pick a test — the result
            lands on whichever test the QR points to.
          </Para>
          <Kicker>Ingesting to the palette</Kicker>
          <Para>
            Measuring is free, but saving those colours to the{" "}
            <strong>palette</strong> is what makes them reusable on
            the SVG Layers page. On the test page, pick an ingest mode
            and press <strong>Ingest to palette</strong>:
          </Para>
          <Para>
            <strong>Averaged</strong> combines every non-excluded
            result into a single swatch per cell — good when you have
            two or three reruns and want the stable mean.{" "}
            <strong>From specific result</strong> ignores other runs
            and takes the colours from a single photo — good when one
            run nailed it and the others were off.
          </Para>
          <Para>
            The <strong>replace existing</strong> checkbox wipes any
            palette entries previously saved for this test before
            writing the new ones — flip it on when you're updating a
            palette with fresh measurements.
          </Para>
          <Callout kicker="exclude" tone="note">
            If one of your results is out of focus, angled weirdly, or
            just bad, tick its{" "}
            <strong>exclude</strong> checkbox on the results list.
            Averaging skips excluded results; the photo stays
            attached for reference.
          </Callout>
        </>
      }
      aside={
        <>
          <IngestPipeline />
          <Figure
            src="/guide/fig-3-1-upload-dialog.png"
            label="FIG. 3.1 — UPLOAD DIALOG"
            aspect="16 / 10"
            pins={[
              { xPct: 50, yPct: 46, tag: 1, caption: "Photograph in, test routed out — the server auto-matches via QR." },
              { xPct: 50, yPct: 58, tag: 2, caption: "Drop or click to pick — JPEG / PNG / HEIC." },
              { xPct: 36, yPct: 44, tag: 3, caption: "From phone — pair via QR for a mobile upload." },
            ]}
          />
          <Figure
            src="/guide/fig-3-2-ingest-palette.png"
            label="FIG. 3.2 — INGEST TO PALETTE"
            aspect="16 / 10"
            pins={[
              { xPct: 78, yPct: 54, tag: 1, caption: "Averaged across all non-excluded results vs from a specific upload." },
              { xPct: 78, yPct: 64, tag: 2, caption: "Replace existing palette entries for this test." },
              { xPct: 74, yPct: 74, tag: 3, caption: "Ingest — writes into the Palette page for the material." },
            ]}
          />
        </>
      }
    />
  );
}

/** `IngestPipeline` — explicit homage to SpectrumAbout's `Pipeline`,
 *  with the four-step photo-to-palette flow and the glyphs we already
 *  have vocabulary for (`Photo → QR+ArUcos → Grid → Palette`). */
function IngestPipeline() {
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-4">
      <div className="inline-flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-3">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Photo → palette in four steps
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2">
        <PipelineStep label="Photo" detail="phone, any angle" icon={<GlyphPhoto />} />
        <PipelineArrow />
        <PipelineStep label="Fiducials" detail="QR + 3 ArUcos" icon={<GlyphFiducials />} />
        <PipelineArrow />
        <PipelineStep label="Grid" detail="un-warped cells" icon={<GlyphGrid />} />
        <PipelineArrow />
        <PipelineStep label="Palette" detail="Lab + params" icon={<GlyphSwatches />} />
      </div>
    </div>
  );
}

function PipelineStep({
  label,
  detail,
  icon,
}: {
  label: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] text-[color:var(--color-primary)]">
        {icon}
      </div>
      <div className="mt-2 font-mono text-[11.5px] font-semibold tracking-[0.06em] text-[color:var(--color-ink)]">
        {label}
      </div>
      <div className="font-mono text-[9.5px] tabular-nums text-[color:var(--color-ink-subtle)]">
        {detail}
      </div>
    </div>
  );
}

function PipelineArrow() {
  return (
    <svg viewBox="0 0 48 12" className="w-12 h-3" style={{ color: "var(--color-border-strong)" }}>
      <line x1={0} y1={6} x2={44} y2={6} stroke="currentColor" strokeWidth={1} strokeDasharray="3 2" />
      <polyline points="40,2 46,6 40,10" fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

function GlyphPhoto() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <rect x={3} y={6} width={18} height={14} rx={2} />
      <circle cx={12} cy={13} r={4} />
      <line x1={16} y1={6} x2={16} y2={4} />
      <line x1={19} y1={6} x2={19} y2={4} />
    </svg>
  );
}

function GlyphFiducials() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <rect x={3} y={3} width={8} height={8} />
      <rect x={5} y={5} width={4} height={4} fill="currentColor" stroke="none" />
      <rect x={15} y={3} width={5} height={5} />
      <rect x={3} y={15} width={5} height={5} />
      <rect x={15} y={15} width={5} height={5} />
    </svg>
  );
}

function GlyphGrid() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <rect x={3} y={3} width={18} height={18} />
      <line x1={9} y1={3} x2={9} y2={21} />
      <line x1={15} y1={3} x2={15} y2={21} />
      <line x1={3} y1={9} x2={21} y2={9} />
      <line x1={3} y1={15} x2={21} y2={15} />
    </svg>
  );
}

function GlyphSwatches() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <rect x={3}  y={6} width={5} height={12} fill="currentColor" opacity={0.3} stroke="none" />
      <rect x={9}  y={6} width={5} height={12} fill="currentColor" opacity={0.55} stroke="none" />
      <rect x={15} y={6} width={5} height={12} fill="currentColor" opacity={0.85} stroke="none" />
    </svg>
  );
}

/* ========================================================================
 * SECTION IV — Spectrum (brief)
 * ====================================================================== */

function SpectrumBriefSection({ onOpenSpectrum }: { onOpenSpectrum: () => void }) {
  return (
    <TwoCol
      prose={
        <>
          <Para>
            The Spectrum tab is the playground: once you have a tested
            1-axis or 2-axis test, it projects the measured colours
            along a perceptual axis (PC1, L*, hue, chroma, or ΔE from
            the first cell) and fits a curve. It's where you stare at
            a sweep and ask "which power value gives me that colour I
            want?".
          </Para>
          <Para>
            There's a dedicated 2-axis page for dual-parameter tests
            with three views — atlas, drift map, and crosshair strips
            — tied together by one pin. This is a brief pointer, not a
            tutorial; hit the <strong>Field manual</strong> pill in
            the Spectrum header for the long walk-through.
          </Para>
          <CtaButton onClick={onOpenSpectrum}>Open the Spectrum tab →</CtaButton>
          <Callout kicker="stability chip" tone="tip">
            When you've uploaded two or more results of the same
            test, Spectrum grows a{" "}
            <strong>stability chip</strong> in the header that tells
            you at a glance how reproducible the burn was. Click it
            to jump to the least-stable cell.
          </Callout>
        </>
      }
      aside={
        <Figure
          src="/guide/fig-4-1-spectrum.png"
          label="FIG. 4.1 — SPECTRUM PAGE"
          aspect="16 / 10"
          pins={[
            { xPct: 70, yPct: 12, tag: 1, caption: "Stability chip — only appears when you have ≥ 2 results." },
            { xPct: 35, yPct: 12, tag: 2, caption: "Field manual pill — the deeper dive on projections and fits." },
            { xPct: 50, yPct: 51, tag: 3, caption: "Sampled strip + per-cell variance seismograph." },
            { xPct: 50, yPct: 70, tag: 4, caption: "Modeled strip — degree-N per-channel Lab reconstruction." },
            { xPct: 50, yPct: 92, tag: 5, caption: "Projection plot — PC1 / L* / hue / chroma / ΔE₀ with fit curve." },
          ]}
        />
      }
    />
  );
}

/* ========================================================================
 * SECTION V — SVG Layers & raster tracing
 * ====================================================================== */

function LayersSection({ onOpenLayers }: { onOpenLayers: () => void }) {
  return (
    <>
      <TwoCol
        prose={
          <>
            <Para>
              The Layers page turns any artwork — SVG, PNG, JPG — into
              a multi-colour engraving where each visual colour becomes
              its own laser pass with its own settings. This is the
              part of the app that uses your palette most directly:
              every detected colour can be matched against a palette
              entry for the active material, pulling in the exact
              power/speed/frequency that produced that hex on the tag.
            </Para>
            <Kicker>Raster vs vector</Kicker>
            <Para>
              SVGs are used as-is. For PNG / JPG we run{" "}
              <strong>vtracer</strong> in the browser to turn the
              raster into an SVG first. The four knobs (max colours,
              colour precision, layer difference, filter speckle)
              control how aggressively the tracer merges regions. Hit
              the <strong>Re-trace</strong> button to apply changes —
              the tracer is expensive on large images, so it doesn't
              re-run on every slider tick.
            </Para>
          </>
        }
        aside={
          <>
            <LayersPipeline />
            <Figure
              src="/guide/fig-5-1-svg-upload.png"
              label="FIG. 5.1 — UPLOAD SVG / RASTER"
              aspect="16 / 10"
              pins={[
                { xPct: 15, yPct: 29, tag: 1, caption: "Drop zone — accepts SVG, PNG, JPG, HEIC." },
                { xPct: 15, yPct: 22, tag: 2, caption: "Pick a project material first — unlocks palette match." },
                { xPct: 15, yPct: 62, tag: 3, caption: "Collapse identical layers + Subtract overlaps, per project." },
              ]}
            />
            <Figure
              src="/guide/fig-5-2-vtracer-knobs.png"
              label="FIG. 5.2 — VTRACER KNOBS (RASTER ONLY)"
              aspect="16 / 10"
              pins={[
                { xPct: 9,  yPct: 46, tag: 1, caption: "Max colours — 0 disables pre-quantisation." },
                { xPct: 19, yPct: 46, tag: 2, caption: "Colour precision — detail vs speed." },
                { xPct: 9,  yPct: 54, tag: 3, caption: "Layer difference — collapses similar hues." },
                { xPct: 19, yPct: 54, tag: 4, caption: "Filter speckle — drops JPEG noise." },
                { xPct: 18, yPct: 40, tag: 5, caption: "Re-trace — expensive, only runs when you press." },
              ]}
            />
          </>
        }
      />

      <div className="mt-10">
        <TwoCol
          prose={
            <>
              <Kicker>Detected layers</Kicker>
              <Para>
                Once parsed, every unique fill + stroke colour shows up
                as a <strong>layer</strong>. The sidebar lists them in
                z-order (top-most drawn last). Each layer has a
                checkbox to enable or disable it, a colour chip, and a
                shape-count tally. The main preview updates live as
                you toggle.
              </Para>
              <Para>
                Hide near-white layers by default — they're usually
                unintended (pure-white fills rarely want a laser pass).
                Flip the <strong>Include white</strong> checkbox to
                show them.
              </Para>
              <Kicker>Colouring layers (auto-match)</Kicker>
              <Para>
                With a palette saved for the active material, press{" "}
                <strong>Auto-match all layers to palette</strong> and
                each layer's base params snap to the palette entry
                closest in CIEDE2000 colour distance. This is where
                Section I + III pays off — a palette entry is literally
                "this hex on this material uses these settings", and
                the matcher does the lookup in the browser.
              </Para>
              <Para>
                Per-layer, you can also pick from the{" "}
                <em>top-10 nearest palette entries</em> in a dialog,
                see the predicted hex next to the detected one, and
                read the ΔE. That gives you a quick sanity check when
                auto-match picks something surprising.
              </Para>
              <Kicker>Per-layer editing</Kicker>
              <Para>
                Each layer carries its own{" "}
                <strong>processing type</strong> (Color Fill / Fill
                Vector / Vector Engraving / Vector Cutting / Hatched
                Lines), <strong>scan angle</strong>,{" "}
                <strong>base params</strong>, and — for hatched-lines
                mode — a list of <strong>hatch passes</strong> with
                angle, spacing, thickness, and optional parameter
                ramps. The hatch passes are where you get genuinely
                painterly results: angled crosshatch with a power
                ramp feels hand-drawn.
              </Para>
              <Kicker>Merging colours</Kicker>
              <Para>
                When vtracer emits near-duplicate colours, or the SVG
                came with 40 shades of red that should really be 3,
                open the <strong>Merge colours</strong> dialog. It
                shows all detected colours grouped by perceptual
                similarity; you pick which ones collapse into which,
                and the SVG is rewritten in place. Merging is also
                param-aware — layers with identical base params can
                be merged safely in one click.
              </Para>
              <Kicker>Subtracting overlaps</Kicker>
              <Para>
                Turn on <strong>Subtract overlaps</strong> when stacked
                shapes would engrave the same pixel twice. The
                rendering pipeline computes boolean differences so
                each pixel burns under exactly one layer — saves time,
                prevents over-burning, and avoids colour muddling on
                stainless.
              </Para>
              <Kicker>Preview + Generate</Kicker>
              <Para>
                The centre preview shows exactly what the laser will
                do, with the active material's engraved colours
                substituted for the original fill colours. When it
                looks right, hit <strong>Generate</strong> to download
                the <code>.xcs</code> file. Burn it, photograph the
                result, and — if it's a reference print — ingest it
                back to palette to keep the lookup honest.
              </Para>
              <CtaButton onClick={onOpenLayers}>Open SVG Layers →</CtaButton>
            </>
          }
          aside={
            <>
              <Figure
                src="/guide/fig-5-3-detected-layers.png"
                label="FIG. 5.3 — DETECTED LAYERS PANEL"
                aspect="16 / 10"
                pins={[
                  { xPct: 15, yPct: 52, tag: 1, caption: "One row per unique colour — checkbox + chip + count." },
                  { xPct: 15, yPct: 44, tag: 2, caption: "Auto-match all layers to palette." },
                  { xPct: 15, yPct: 47, tag: 3, caption: "Include white — show near-white layers hidden by default." },
                  { xPct: 15, yPct: 40, tag: 4, caption: "Merge similar — collapse near-duplicate hues." },
                ]}
              />
              <SubtractOverlapsViz />
              <Figure
                src="/guide/fig-5-4-per-layer-editor.png"
                label="FIG. 5.4 — PER-LAYER EDITOR · PALETTE MATCH"
                aspect="16 / 10"
                pins={[
                  { xPct: 40, yPct: 32, tag: 1, caption: "ΔE-ranked palette candidates from the material's saved swatches." },
                  { xPct: 64, yPct: 32, tag: 2, caption: "Apply → bakes the matched preset's power/speed/freq into this layer." },
                  { xPct: 50, yPct: 60, tag: 3, caption: "Params in effect — editable per layer." },
                  { xPct: 50, yPct: 74, tag: 4, caption: "Processing type — fill / engrave / cut / hatched lines." },
                ]}
              />
              <HatchAngleViz />
              <Figure
                src="/guide/fig-5-5-merge-dialog.png"
                label="FIG. 5.5 — MERGE COLOURS DIALOG"
                aspect="16 / 10"
                pins={[
                  { xPct: 50, yPct: 46, tag: 1, caption: "Similarity slider — lower = aggressive merging." },
                  { xPct: 50, yPct: 53, tag: 2, caption: "Preview — colours within the threshold." },
                  { xPct: 62, yPct: 59, tag: 3, caption: "Merge button — rewrites the SVG in place." },
                ]}
              />
              <Figure
                src="/guide/fig-5-6-preview-generate.png"
                label="FIG. 5.6 — PREVIEW + GENERATE"
                aspect="16 / 10"
                pins={[
                  { xPct: 80, yPct: 30, tag: 1, caption: "Design — the traced artwork with original colours." },
                  { xPct: 80, yPct: 75, tag: 2, caption: "Expected burn — what will actually be engraved." },
                  { xPct: 88, yPct: 9,  tag: 3, caption: "Generate .xcs — XCS Studio import-ready." },
                ]}
              />
            </>
          }
        />
      </div>
    </>
  );
}

/** `LayersPipeline` — upload → detect → match+edit → generate. */
function LayersPipeline() {
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-4">
      <div className="inline-flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-3">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Artwork → engraving
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2">
        <PipelineStep label="Upload" detail="SVG or raster" icon={<GlyphUpload />} />
        <PipelineArrow />
        <PipelineStep label="Detect" detail="layer per colour" icon={<GlyphLayers />} />
        <PipelineArrow />
        <PipelineStep label="Match + edit" detail="palette · per layer" icon={<GlyphMatch />} />
        <PipelineArrow />
        <PipelineStep label="Generate" detail=".xcs ready to burn" icon={<GlyphDownload />} />
      </div>
    </div>
  );
}

function GlyphUpload() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M12 16V6" />
      <polyline points="7,11 12,6 17,11" fill="none" />
      <rect x={3} y={18} width={18} height={3} />
    </svg>
  );
}

function GlyphLayers() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <polygon points="12,3 21,8 12,13 3,8" />
      <polyline points="3,13 12,18 21,13" />
      <polyline points="3,18 12,23 21,18" />
    </svg>
  );
}

function GlyphMatch() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.4}>
      <circle cx={9} cy={9} r={5} />
      <circle cx={15} cy={15} r={5} />
      <line x1={12} y1={12} x2={12} y2={12} strokeWidth={2} />
    </svg>
  );
}

function GlyphDownload() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M12 4v12" />
      <polyline points="7,11 12,16 17,11" fill="none" />
      <rect x={4} y={18} width={16} height={2.5} />
    </svg>
  );
}

/** `SubtractOverlapsViz` — three overlapping shapes with a "before /
 *  after" split showing how the lower layer loses its overlap area. */
function SubtractOverlapsViz() {
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
      <div className="inline-flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-2">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Subtract overlaps
      </div>
      <svg viewBox="0 0 240 90" className="w-full h-auto">
        {/* Before */}
        <g transform="translate(10, 10)">
          <text x={0} y={-2} style={{ font: "bold 7px var(--font-mono)", fill: "var(--color-ink-subtle)", letterSpacing: "0.12em" }}>
            OFF
          </text>
          <circle cx={30} cy={40} r={22} fill="#b26a1c" opacity={0.85} />
          <circle cx={55} cy={40} r={22} fill="#3c8a74" opacity={0.85} />
          <circle cx={80} cy={40} r={22} fill="#74809f" opacity={0.85} />
          <text x={55} y={82} textAnchor="middle" style={{ font: "6.5px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
            overlaps = double-burn
          </text>
        </g>
        {/* Divider */}
        <line x1={120} y1={10} x2={120} y2={82} stroke="var(--color-border)" strokeWidth={1} strokeDasharray="2 2" />
        {/* After */}
        <g transform="translate(130, 10)">
          <text x={0} y={-2} style={{ font: "bold 7px var(--font-mono)", fill: "var(--color-primary)", letterSpacing: "0.12em" }}>
            ON
          </text>
          <defs>
            <mask id="subtract-lower">
              <rect width={120} height={80} fill="white" />
              <circle cx={55} cy={40} r={22} fill="black" />
              <circle cx={80} cy={40} r={22} fill="black" />
            </mask>
            <mask id="subtract-mid">
              <rect width={120} height={80} fill="white" />
              <circle cx={80} cy={40} r={22} fill="black" />
            </mask>
          </defs>
          <circle cx={30} cy={40} r={22} fill="#b26a1c" mask="url(#subtract-lower)" />
          <circle cx={55} cy={40} r={22} fill="#3c8a74" mask="url(#subtract-mid)" />
          <circle cx={80} cy={40} r={22} fill="#74809f" />
          <text x={55} y={82} textAnchor="middle" style={{ font: "6.5px var(--font-mono)", fill: "var(--color-primary)" }}>
            each pixel burns once
          </text>
        </g>
      </svg>
    </div>
  );
}

/** `HatchAngleViz` — three tiny squares at 0° / 45° / 90° scan-line
 *  angles, as a chip-row glyph when hatch passes are introduced. */
function HatchAngleViz() {
  const Square = ({ angle }: { angle: number }) => (
    <g>
      <rect x={0} y={0} width={28} height={28} rx={3}
        fill="var(--color-surface)"
        stroke="var(--color-border-strong)" strokeWidth={0.8}
      />
      {Array.from({ length: 10 }).map((_, i) => {
        const t = (i / 9) * 28;
        return (
          <line
            key={i}
            x1={t} y1={0} x2={t} y2={28}
            stroke="var(--color-primary)"
            strokeWidth={0.8}
            transform={`rotate(${angle} 14 14)`}
          />
        );
      })}
      <text x={14} y={40} textAnchor="middle" style={{ font: "6.5px var(--font-mono)", fill: "var(--color-ink-subtle)" }}>
        {angle}°
      </text>
    </g>
  );
  return (
    <div className="rounded-[10px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
      <div className="inline-flex items-center gap-2 font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)] mb-2">
        <span className="h-px w-4 bg-[color:var(--color-border-strong)]" aria-hidden />
        Hatch angles
      </div>
      <svg viewBox="0 0 140 48" className="w-full h-auto">
        <g transform="translate(8, 4)"><Square angle={0} /></g>
        <g transform="translate(56, 4)"><Square angle={45} /></g>
        <g transform="translate(104, 4)"><Square angle={90} /></g>
      </svg>
    </div>
  );
}

/* Shush unused — some helpers are here for completeness and referenced
 * only by the composed sections above. */
void useMemo;
