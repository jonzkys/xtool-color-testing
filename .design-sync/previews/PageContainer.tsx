import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  MetalBar,
  PageContainer,
  Section,
  Toolbar,
} from "xcs-gen-web";
import { Plus } from "lucide-react";
import { type ReactNode } from "react";

/** The warm page ground. Every gutter the container reserves reads against
 *  it, so the horizontal padding is visible instead of implied. */
function Ground({ children }: { children: ReactNode }) {
  return <div className="bg-[color:var(--color-bg)]">{children}</div>;
}

export function DefaultWidth() {
  return (
    <Ground>
      <PageContainer className="py-6">
        <Section
          title="Validated palette"
          description="Cells bucketed by cross-run burn σ. Saved cells become new palette entries."
          actions={
            <Button variant="secondary" size="sm">
              <Plus className="h-3.5 w-3.5" />
              New entry
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Brass 3.0mm</CardTitle>
                <Badge variant="success" size="sm" className="ml-auto">
                  12 stable
                </Badge>
              </CardHeader>
              <div className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink-muted)]">
                speed 600–1500 · P 10.0% · F 125 Hz · PW 250 ns
              </div>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Anodised aluminium</CardTitle>
                <Badge variant="warning" size="sm" className="ml-auto">
                  3 marginal
                </Badge>
              </CardHeader>
              <div className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink-muted)]">
                speed 900–2200 · P 6.5% · F 60 Hz · PW 100 ns
              </div>
            </Card>
          </div>
        </Section>
      </PageContainer>
    </Ground>
  );
}

export function WideLayout() {
  const layers = ["Outline", "Engrave", "Near-white", "Registration"];
  return (
    <Ground>
      <PageContainer maxWidth="wide" className="py-6">
        <Section title="SVG Layers" dense>
          <Toolbar
            trailing={
              <Button variant="primary" size="sm">
                Generate .xcs
              </Button>
            }
          >
            <Badge variant="info">17 layers</Badge>
            <Badge variant="neutral">1 hidden</Badge>
          </Toolbar>
          <MetalBar variant="soft" />
          <div className="grid grid-cols-3 gap-4">
            <Card padded={false} className="overflow-hidden">
              <div className="border-b border-[color:var(--color-border)] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
                Layers
              </div>
              {layers.map((l) => (
                <div
                  key={l}
                  className="flex items-center justify-between px-3 py-2 text-[12.5px] text-[color:var(--color-ink)]"
                >
                  {l}
                  <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                    t2
                  </span>
                </div>
              ))}
            </Card>
            <Card variant="inset" padded={false} className="overflow-hidden">
              <div className="px-3 py-2 font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
                preview · 240 × 160 mm
              </div>
              <div className="grid grid-cols-6 gap-px px-3 pb-3">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-5 rounded-sm"
                    style={{
                      background: `hsl(${20 + (i % 6) * 4} 46% ${24 + Math.floor(i / 6) * 13}%)`,
                    }}
                  />
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cut order</CardTitle>
              </CardHeader>
              <div className="flex flex-col gap-1 font-mono text-[11px] tabular-nums text-[color:var(--color-ink-muted)]">
                <span>1 · engrave · 2:14</span>
                <span>2 · pocket · 4:36</span>
                <span>3 · contour · 1:36</span>
              </div>
            </Card>
          </div>
        </Section>
      </PageContainer>
    </Ground>
  );
}

export function Bleed() {
  return (
    <Ground>
      <PageContainer bleed className="py-6">
        <Toolbar
          trailing={
            <Button variant="secondary" size="sm">
              Export G-code
            </Button>
          }
        >
          <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-[color:var(--color-ink)]">
            Burn test sheet
          </span>
          <Badge variant="neutral" size="sm">
            18 cells · 6 × 3
          </Badge>
        </Toolbar>
        <MetalBar variant="soft" />
        <Card variant="inset" padded={false} className="mt-3 overflow-hidden">
          <div className="px-4 py-3 font-mono text-[11px] tabular-nums text-[color:var(--color-ink-subtle)]">
            speed 600–1500 mm/s · P 10.0% · F 125 Hz · PW 250 ns
          </div>
          <div className="grid grid-cols-6 gap-px px-4 pb-4">
            {Array.from({ length: 18 }).map((_, i) => (
              <div
                key={i}
                className="h-6 rounded-sm"
                style={{
                  background: `hsl(${22 + (i % 6) * 4} 48% ${26 + Math.floor(i / 6) * 13}%)`,
                }}
              />
            ))}
          </div>
        </Card>
      </PageContainer>
    </Ground>
  );
}
