import { Badge, Card, Field, HelpTooltip, IconButton, Input, Toolbar } from "xcs-gen-web";
import { Info } from "lucide-react";

export function InFieldLabel() {
  return (
    <Card className="max-w-[420px]">
      <div className="flex flex-col gap-3">
        <Field
          label="Spacing (mm)"
          help="Distance between adjacent hatch lines. Below the measured kerf width the passes overlap and the fill goes muddy."
        >
          <Input mono defaultValue="0.12" />
        </Field>
        <Field
          label="Pulse width (ns)"
          help="Only the machine's preset ladder is legal — a value off the ladder is snapped to the nearest legal one, never rejected."
          hint="F2 Ultra ladder: 2, 4, 6, 10, 20, 40, 60, 100, 200, 350 ns."
        >
          <Input mono defaultValue="200" />
        </Field>
      </div>
    </Card>
  );
}

export function InlineLabelRow() {
  return (
    <Card className="max-w-[420px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[color:var(--color-ink-muted)]">
            <span>Cross-run burn σ</span>
            <HelpTooltip>
              Standard deviation of the measured L* across repeat burns of the
              same cell. Stability is the gate for the validated palette — not
              ΔE against the original photo.
            </HelpTooltip>
          </span>
          <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
            0.42
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[color:var(--color-ink-muted)]">
            <span>Estimated cut time</span>
            <HelpTooltip>
              Calibrated against F2 Ultra probe cuts at a 15° head. Speed barely
              moves the total — passes and focus step-downs dominate.
            </HelpTooltip>
          </span>
          <span className="font-mono text-[12px] tabular-nums text-[color:var(--color-ink)]">
            4 m 18 s
          </span>
        </div>
      </div>
    </Card>
  );
}

export function BesideSectionHeader() {
  return (
    <Card className="max-w-[420px]">
      <Toolbar>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink)]">
          Layers
        </span>
        <Badge variant="info" size="sm">17 layers</Badge>
        <Badge variant="neutral" size="sm">1 hidden</Badge>
        <HelpTooltip>
          Layers flagged as near-white are hidden by default. Tick the checkbox
          to include them.
        </HelpTooltip>
      </Toolbar>
    </Card>
  );
}

export function CustomTrigger() {
  return (
    <Card className="max-w-[420px]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Spiral Cut</div>
          <div className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)]">
            Brass 3.0mm · 0.8 mm channel · focus step-down
          </div>
        </div>
        <HelpTooltip
          trigger={
            <IconButton
              aria-label="About the spiral cut strategy"
              variant="ghost"
              size="sm"
              icon={<Info className="h-3.5 w-3.5" />}
            />
          }
        >
          A wide continuous spiral severs 3 mm brass at high speed where a
          narrow kerf stalls. Roughly 57% of the time an incise pass takes.
        </HelpTooltip>
      </div>
    </Card>
  );
}
