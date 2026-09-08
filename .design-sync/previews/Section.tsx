import { Badge, Button, Card, MetalBar, Section } from "xcs-gen-web";
import { Plus } from "lucide-react";

export function WithActions() {
  return (
    <Section
      title="Hatch passes"
      actions={
        <Button variant="secondary" size="sm">
          <Plus className="h-3.5 w-3.5" />
          Add pass
        </Button>
      }
    >
      <Card variant="elevated" padded={false} className="p-3">
        <div className="flex items-center gap-2">
          <Badge variant="accent" size="sm">Pass 1</Badge>
          <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
            45° · 0.12mm · t2
          </span>
        </div>
      </Card>
      <Card variant="elevated" padded={false} className="p-3">
        <div className="flex items-center gap-2">
          <Badge variant="accent" size="sm">Pass 2</Badge>
          <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
            135° · 0.12mm · t2
          </span>
        </div>
      </Card>
    </Section>
  );
}

export function WithDescription() {
  return (
    <Section
      title="Validated palette"
      description="Cells are bucketed by cross-run burn σ, not by ΔE against the original photo. A saved cell usually becomes a new palette entry."
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success" size="sm">12 stable</Badge>
        <Badge variant="warning" size="sm">3 marginal</Badge>
        <Badge variant="destructive" size="sm">1 rejected</Badge>
      </div>
    </Section>
  );
}

export function Dense() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Machine" dense>
        <span className="font-mono text-[12px] text-[color:var(--color-ink-muted)]">
          F2 Ultra · 1064nm · 15° head
        </span>
      </Section>
      <MetalBar variant="soft" />
      <Section title="Material" dense>
        <span className="font-mono text-[12px] text-[color:var(--color-ink-muted)]">
          Brass 3.0mm · anodised black
        </span>
      </Section>
    </div>
  );
}
