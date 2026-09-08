import { Badge, Button, HelpTooltip, MetalBar, Select, Toolbar } from "xcs-gen-web";
import { Download, RefreshCw, Upload } from "lucide-react";
import { type ReactNode } from "react";

/** Toolbars are transparent — they always sit on a page, never on white. */
function Page({ children }: { children: ReactNode }) {
  return <div className="bg-[color:var(--color-bg)] px-6 py-3">{children}</div>;
}

export function PageHeader() {
  return (
    <Page>
      <Toolbar
        trailing={
          <>
            <Button variant="ghost" size="sm">
              <RefreshCw className="h-3.5 w-3.5" />
              Re-render
            </Button>
            <Button variant="secondary" size="sm">
              <Upload className="h-3.5 w-3.5" />
              Replace…
            </Button>
            <Button variant="primary" size="sm">
              <Download className="h-3.5 w-3.5" />
              Export cleaned PNG
            </Button>
          </>
        }
      >
        <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink)]">
          Relief
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-[color:var(--color-ink-muted)]">
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-success)" }}
          />
          depth map ready · 2048 × 1536 · 16-bit
        </span>
      </Toolbar>
      <MetalBar variant="soft" />
    </Page>
  );
}

export function WithTrailingActions() {
  return (
    <Page>
      <Toolbar
        trailing={
          <>
            <Button variant="ghost" size="sm">
              Reset
            </Button>
            <Button variant="primary" size="sm">
              Apply
            </Button>
          </>
        }
      >
        <Badge variant="info">17 layers</Badge>
        <Badge variant="neutral">1 hidden</Badge>
        <HelpTooltip>
          Layers flagged as near-white are hidden by default. Tick the checkbox
          to include them in the cut.
        </HelpTooltip>
      </Toolbar>
    </Page>
  );
}

export function LeadingOnly() {
  return (
    <Page>
      <Toolbar>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          Job
        </span>
        <Select defaultValue="pocket" className="w-auto">
          <option value="pocket">Pocket · CUT_01_POCKET</option>
          <option value="contour">Contour · CUT_02_CONTOUR</option>
        </Select>
        <span className="truncate font-mono text-[12px] text-[color:var(--color-ink-muted)] max-w-[420px]">
          bracket-v4.gc · 41,208 lines · 62 ms
        </span>
      </Toolbar>
    </Page>
  );
}

export function WrappedFilters() {
  const chips = [
    "Brass 3.0mm",
    "F2 Ultra",
    "Speed 600–1500 mm/s",
    "Power 10.0%",
    "Frequency 125 Hz",
    "Pulse width 250 ns",
    "Line spacing 0.12 mm",
    "Angle 45°",
    "Hatch passes 4",
    "Burn σ < 1.4",
    "Validated palette only",
    "Excludes near-white",
  ];
  return (
    <Page>
      <Toolbar
        trailing={
          <Button variant="ghost" size="sm">
            Clear all
          </Button>
        }
      >
        {chips.map((c) => (
          <Badge key={c} variant="neutral" size="sm">
            {c}
          </Badge>
        ))}
      </Toolbar>
    </Page>
  );
}
