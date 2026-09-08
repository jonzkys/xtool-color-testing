import { Badge, Card, MetalBar } from "xcs-gen-web";
import { type ReactNode } from "react";

function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
      {children}
    </div>
  );
}

/** The strip is 1 px tall, so each variant is shown at 1× on a surface and
 *  again vertically magnified — the gradient is the whole point. */
function VariantRow({
  variant,
  title,
  blurb,
}: {
  variant?: "default" | "soft";
  title: string;
  blurb: string;
}) {
  return (
    <div>
      <Label>{title}</Label>
      <div className="rounded-[8px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-6">
        <MetalBar variant={variant} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          ×8 detail
        </span>
        <div className="flex h-6 flex-1 items-center overflow-hidden">
          <div className="w-full" style={{ transform: "scaleY(8)" }}>
            <MetalBar variant={variant} />
          </div>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-[color:var(--color-ink-muted)]">{blurb}</p>
    </div>
  );
}

export function Variants() {
  return (
    <div className="flex flex-col gap-6 bg-[color:var(--color-bg)] p-6">
      <VariantRow
        title="default — full strength"
        blurb="Closes the TopBar and the header of a dialog — the brightest reading of the motif."
      />
      <VariantRow
        variant="soft"
        title="soft — in-page divider"
        blurb="Separates rows inside a card or a Section, where a full-strength bar would shout."
      />
    </div>
  );
}

export function UnderTopBar() {
  const nav = ["Tests", "Palette", "Spectrum", "Forge", "Relief"];
  return (
    <div className="bg-[color:var(--color-bg)]">
      <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <div className="flex h-14 items-center gap-6 px-6">
          <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink)]">
            xcs-gen
          </span>
          <nav className="flex items-center gap-4">
            {nav.map((n, i) => (
              <span
                key={n}
                className={
                  i === 3
                    ? "text-[12.5px] font-medium text-[color:var(--color-primary)]"
                    : "text-[12.5px] text-[color:var(--color-ink-muted)]"
                }
              >
                {n}
              </span>
            ))}
          </nav>
          <Badge variant="accent" size="sm" className="ml-auto">
            F2 Ultra
          </Badge>
        </div>
      </header>
      <MetalBar />
      <div className="px-6 py-6">
        <p className="text-[13px] text-[color:var(--color-ink-muted)]">
          The bar rides the seam between the header surface and the warm page
          background — one pixel of brushed metal, edge to edge.
        </p>
      </div>
    </div>
  );
}

export function SectionDivider() {
  const rows = [
    { label: "Machine", value: "F2 Ultra · 1064 nm · 15° head" },
    { label: "Material", value: "Brass 3.0mm · anodised black" },
    { label: "Thickness (mm)", value: "3.00 · measured 2.97" },
  ];
  return (
    <div className="bg-[color:var(--color-bg)] p-6">
      <Card className="max-w-[520px]">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-3 py-2">
              <span className="text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
                {r.label}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
                {r.value}
              </span>
            </div>
            {i < rows.length - 1 && <MetalBar variant="soft" />}
          </div>
        ))}
      </Card>
    </div>
  );
}
