import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from "xcs-gen-web";

export function SimplifyShapes() {
  return (
    <Dialog open>
      <DialogContent width="md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Simplify shapes</DialogTitle>
          <DialogDescription>
            xTool Studio gets sluggish past ~1k shapes. Drop tiny artefacts and
            reduce vertex count on long polylines — curves are left untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Drop shapes smaller than" inline>
            <Input mono defaultValue="0.35" />
          </Field>
          <Field label="Simplification tolerance (mm)" inline>
            <Input mono defaultValue="0.02" />
          </Field>
        </div>

        <div className="mt-4 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] px-3 py-3">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[18px] tabular-nums text-[color:var(--color-ink)]">
                  2,914
                </span>
                <span className="text-[color:var(--color-ink-subtle)]">→</span>
                <span className="font-mono text-[18px] tabular-nums text-[color:var(--color-primary)]">
                  841
                </span>
                <span className="text-[12px] text-[color:var(--color-ink-muted)]">
                  shapes
                </span>
              </div>
              <div className="font-mono text-[11px] tabular-nums text-[color:var(--color-ink-muted)]">
                48,120 → 12,663 vertices
              </div>
            </div>
            <Badge variant="success" size="sm">−71%</Badge>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary">Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDestructiveSm() {
  return (
    <Dialog open>
      <DialogContent width="sm" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Delete test?</DialogTitle>
          <DialogDescription>
            “Brass 3.0mm — speed × power sweep” has 48 ingested swatches. The
            palette entries it produced stay; the test and its result photos are
            removed for good.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Keep test</Button>
          </DialogClose>
          <Button variant="destructive">Delete test</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SaveSpectrumMd() {
  return (
    <Dialog open>
      <DialogContent width="md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Save spectrum</DialogTitle>
        </DialogHeader>

        <Field label="Name">
          <Input defaultValue="Brass 3.0mm · pulse width ramp" />
        </Field>

        <div className="mt-3 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3 text-[12px]">
          <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
            <div className="text-[color:var(--color-ink-muted)]">Source</div>
            <div className="font-mono">Test #214 · Brass 3.0mm sweep</div>
            <div className="text-[color:var(--color-ink-muted)]">Axis</div>
            <div className="font-mono">pulse_width: 4 → 350 ns (24 points)</div>
            <div className="text-[color:var(--color-ink-muted)]">Fit</div>
            <div className="font-mono">
              polynomial · degree 3
              <br />
              L* R² 0.994 · a* R² 0.961 · b* R² 0.973
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="primary">Save spectrum</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResultDebugLg() {
  return (
    <Dialog open>
      <DialogContent width="lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Result debug — capture #1042</DialogTitle>
          <DialogDescription>
            Warp, white-balance and swatch sampling as the ingest pipeline saw
            them. Values are read straight off the stored frame.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
              Fiducials
            </div>
            <div className="mt-2 font-mono text-[12px] tabular-nums">
              4 / 4 found · reprojection 0.31 px
            </div>
            <div className="mt-2">
              <Badge variant="success" size="sm">warp accepted</Badge>
            </div>
          </div>
          <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
              White balance
            </div>
            <div className="mt-2 font-mono text-[12px] tabular-nums">
              gain 1.04 / 1.00 / 1.11
            </div>
            <div className="mt-2">
              <Badge variant="warning" size="sm">WB · CHROMA</Badge>
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] p-3">
          <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[12px]">
            <div className="text-[color:var(--color-ink-muted)]">Swatches</div>
            <div className="font-mono">48 sampled · 2 clipped · 0 dropped</div>
            <div className="text-[color:var(--color-ink-muted)]">Burn σ</div>
            <div className="font-mono">mean 0.42 · max 1.87 (cell 6×3)</div>
            <div className="text-[color:var(--color-ink-muted)]">Machine</div>
            <div className="font-mono">F2 Ultra · GS004-CLASS-4 · 1064 nm</div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="secondary">Copy JSON</Button>
          <DialogClose asChild>
            <Button variant="primary">Close</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
