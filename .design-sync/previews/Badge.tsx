import { Badge, Card } from "xcs-gen-web";

export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral">1 hidden</Badge>
      <Badge variant="accent">Applied</Badge>
      <Badge variant="info">17 layers</Badge>
      <Badge variant="success">ingested</Badge>
      <Badge variant="warning">WB · CHROMA</Badge>
      <Badge variant="destructive">rejected</Badge>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          sm
        </span>
        <Badge variant="accent" size="sm">Pass 1</Badge>
        <Badge variant="info" size="sm">Brass 3.0mm</Badge>
        <Badge variant="success" size="sm">σ 0.42</Badge>
        <Badge variant="neutral" size="sm">200 ns</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          md
        </span>
        <Badge variant="accent" size="md">Pass 1</Badge>
        <Badge variant="info" size="md">Brass 3.0mm</Badge>
        <Badge variant="success" size="md">σ 0.42</Badge>
        <Badge variant="neutral" size="md">200 ns</Badge>
      </div>
    </div>
  );
}

export function TestListRows() {
  return (
    <div className="flex flex-col gap-2 max-w-[420px]">
      <Card padded={false} className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">
              Brass 3.0mm — speed × power sweep
            </div>
            <div className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)] truncate">
              F2 Ultra · fiber laser
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="success" size="sm">burned</Badge>
            <Badge variant="success" size="sm">ingested</Badge>
          </div>
        </div>
      </Card>
      <Card padded={false} className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">
              Anodised aluminium — pulse width validation
            </div>
            <div className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)] truncate">
              F2 Ultra · fiber laser
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="accent" size="sm">queued</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function StackedNotices() {
  return (
    <div className="flex flex-col items-start gap-1 max-w-[420px]">
      <Badge variant="accent">ready</Badge>
      <Badge
        variant="warning"
        className="block w-full whitespace-normal break-words rounded-md text-left py-1"
      >
        Pass 2 spacing (0.08 mm) sits below the measured kerf width for brass —
        the passes will overlap.
      </Badge>
      <Badge
        variant="destructive"
        className="block w-full whitespace-normal break-words rounded-md text-left py-1"
      >
        Spiral arm is 1,884 points; Studio drops single paths past ~1,570 on
        import.
      </Badge>
    </div>
  );
}
