import { Badge, Button, Card, CardFooter, CardHeader, CardTitle } from "xcs-gen-web";
import { RotateCcw } from "lucide-react";
import { Fragment, type ReactNode } from "react";

/** The page background the app always puts cards on — without it a
 *  `default` card (pure white surface) has nothing to read against. */
function Page({ children }: { children: ReactNode }) {
  return <div className="bg-[color:var(--color-bg)] p-6">{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

export function Composed() {
  return (
    <Page>
      <Card className="max-w-[420px]">
        <CardHeader>
          <CardTitle>Cut target</CardTitle>
          <Badge variant="accent" className="ml-auto">
            Brass 3.0mm
          </Badge>
        </CardHeader>
        <p className="text-[13px] leading-relaxed text-[color:var(--color-ink-muted)]">
          Spiral cut on the F2 Ultra — a 0.82 mm channel with the focus stepping
          down per pass. The contour is always cut last, so the part stays keyed
          to the sheet until the final pass.
        </p>
        <div className="mt-3 flex flex-col gap-1">
          <Stat label="Speed (mm/s)" value="1200" />
          <Stat label="Pulse width (ns)" value="250" />
          <Stat label="Passes" value="18" />
        </div>
        <CardFooter>
          <Button variant="ghost" size="sm">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
          <Button variant="primary" size="sm">
            Generate .xcs
          </Button>
        </CardFooter>
      </Card>
    </Page>
  );
}

export function Variants() {
  const items = [
    {
      variant: "default",
      title: "Hatch passes",
      body: "Hairline border, white surface, a whisper of shadow. The default home for grouped controls.",
    },
    {
      variant: "elevated",
      title: "Validated palette",
      body: "Warmer fill, same shadow. Reach for it when a card has to sit on top of another card.",
    },
    {
      variant: "inset",
      title: "Preview",
      body: "Takes the page background, so the artwork inside is the thing you look at.",
    },
  ] as const;
  return (
    <Page>
      <div className="flex flex-wrap gap-4">
        {items.map((it) => (
          <Card key={it.variant} variant={it.variant} style={{ flex: "1 1 210px", minWidth: 0 }}>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-primary)]">
              {it.variant}
            </div>
            <div className="mt-2 text-[13px] font-semibold text-[color:var(--color-ink)]">
              {it.title}
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--color-ink-muted)]">
              {it.body}
            </p>
          </Card>
        ))}
      </div>
    </Page>
  );
}

export function Unpadded() {
  const passes = [
    { n: "Pass 1", angle: "45°", spacing: "0.12 mm" },
    { n: "Pass 2", angle: "135°", spacing: "0.12 mm" },
    { n: "Pass 3", angle: "90°", spacing: "0.18 mm" },
    { n: "Pass 4", angle: "0°", spacing: "0.18 mm" },
  ];
  return (
    <Page>
      <Card padded={false} className="max-w-[420px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            Hatch passes
          </span>
          <Badge variant="neutral" size="sm">
            4 passes
          </Badge>
        </div>
        {passes.map((p, i) => (
          <div
            key={p.n}
            className={
              i < passes.length - 1
                ? "flex items-center justify-between border-b border-[color:var(--color-border)] px-3 py-2"
                : "flex items-center justify-between px-3 py-2"
            }
          >
            <span className="text-[12.5px] text-[color:var(--color-ink)]">{p.n}</span>
            <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink-subtle)]">
              {p.angle} · {p.spacing}
            </span>
          </div>
        ))}
      </Card>
    </Page>
  );
}

export function EstimatePanel() {
  const stages = [
    { name: "pierce", time: "0:12", pct: "4", sl: "1×1" },
    { name: "spiral pocket ×3", time: "2:48", pct: "61", sl: "6×2" },
    { name: "contour", time: "1:36", pct: "35", sl: "3×1" },
  ];
  return (
    <Page>
      <Card variant="elevated" className="max-w-[420px]">
        <CardHeader>
          <CardTitle>Estimated cut time</CardTitle>
          <Badge variant="warning" className="ml-auto">
            128% of incise
          </Badge>
        </CardHeader>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-[16px] tabular-nums text-[color:var(--color-ink)]">
            4:36
          </span>
          <span className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink-muted)]">
            baseline incise 3:35
          </span>
        </div>
        <div
          className="mt-3 grid gap-2 font-mono text-[11px] tabular-nums"
          style={{ gridTemplateColumns: "1fr 44px 28px 40px" }}
        >
          <span className="uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            stage
          </span>
          <span className="text-right uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            time
          </span>
          <span className="text-right uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            %
          </span>
          <span className="text-right uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
            sl×rp
          </span>
          {stages.map((s) => (
            <Fragment key={s.name}>
              <span className="truncate text-[color:var(--color-ink)]">{s.name}</span>
              <span className="text-right text-[color:var(--color-ink)]">{s.time}</span>
              <span className="text-right text-[color:var(--color-ink-muted)]">{s.pct}</span>
              <span className="text-right text-[color:var(--color-ink-muted)]">{s.sl}</span>
            </Fragment>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-[color:var(--color-ink-subtle)]">
          <span>pierces 3</span>
          <span>pockets 3</span>
          <span>bands 14</span>
          <span>budget 1.2×</span>
        </div>
      </Card>
    </Page>
  );
}
