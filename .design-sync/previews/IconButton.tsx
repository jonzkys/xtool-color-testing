import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Grid3x3,
  Plus,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge, IconButton } from "xcs-gen-web";

function Specimen({
  caption,
  note,
  children,
}: {
  caption: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      <div className="flex h-9 items-center gap-2">{children}</div>
      <div className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink)]">
        {caption}
      </div>
      <div className="mt-1 text-[12px] text-[color:var(--color-ink-muted)]">
        {note}
      </div>
    </div>
  );
}

function PassRow({
  index,
  angle,
  first,
  last,
}: {
  index: number;
  angle: number;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      <div className="flex items-center gap-2">
        <Badge variant="accent" size="sm">Pass {index}</Badge>
        <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
          {angle}° · 0.12mm · t2
        </span>
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          aria-label={`Move pass ${index} up`}
          size="sm"
          variant="ghost"
          disabled={first}
          icon={<ArrowUp className="h-3.5 w-3.5" />}
        />
        <IconButton
          aria-label={`Move pass ${index} down`}
          size="sm"
          variant="ghost"
          disabled={last}
          icon={<ArrowDown className="h-3.5 w-3.5" />}
        />
        <IconButton
          aria-label={`Remove pass ${index}`}
          size="sm"
          variant="ghost"
          icon={<X className="h-3.5 w-3.5" />}
          className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
        />
      </div>
    </div>
  );
}

export function Variants() {
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[640px]">
      <Specimen caption="default" note="Bordered — sits on a surface next to a readout.">
        <IconButton
          aria-label="Preview layer"
          icon={<Eye className="h-4 w-4" />}
        />
      </Specimen>
      <Specimen caption="ghost" note="No chrome — for dense toolbars and row clusters.">
        <IconButton
          variant="ghost"
          aria-label="Hide layer"
          icon={<EyeOff className="h-4 w-4" />}
        />
      </Specimen>
      <Specimen caption="active" note="Ember tint + border — the toggled-on state.">
        <IconButton
          variant="active"
          aria-label="Isolate selected layer"
          icon={<Eye className="h-4 w-4" />}
        />
      </Specimen>
    </div>
  );
}

export function Sizes() {
  return (
    <div className="grid grid-cols-2 gap-3 max-w-[640px]">
      <Specimen caption="sm · 28px" note="Inline beside an 11px mono readout.">
        <IconButton
          size="sm"
          aria-label="Add hatch pass"
          icon={<Plus className="h-3.5 w-3.5" />}
        />
        <IconButton
          size="sm"
          variant="ghost"
          aria-label="Move pass up"
          icon={<ArrowUp className="h-3.5 w-3.5" />}
        />
        <IconButton
          size="sm"
          variant="active"
          aria-label="Snap to grid"
          icon={<Grid3x3 className="h-3.5 w-3.5" />}
        />
      </Specimen>
      <Specimen caption="md · 36px" note="Standalone panel action, 16px glyph.">
        <IconButton
          size="md"
          aria-label="Add hatch pass"
          icon={<Plus className="h-4 w-4" />}
        />
        <IconButton
          size="md"
          variant="ghost"
          aria-label="Move pass up"
          icon={<ArrowUp className="h-4 w-4" />}
        />
        <IconButton
          size="md"
          variant="active"
          aria-label="Snap to grid"
          icon={<Grid3x3 className="h-4 w-4" />}
        />
      </Specimen>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[640px]">
      <Specimen caption="default" note="Enabled, then disabled — 40% opacity.">
        <IconButton
          aria-label="Move pass up"
          icon={<ArrowUp className="h-4 w-4" />}
        />
        <IconButton
          disabled
          aria-label="Move first pass up"
          icon={<ArrowUp className="h-4 w-4" />}
        />
      </Specimen>
      <Specimen caption="ghost" note="Enabled, then disabled — 40% opacity.">
        <IconButton
          variant="ghost"
          aria-label="Duplicate test"
          icon={<Copy className="h-4 w-4" />}
        />
        <IconButton
          disabled
          variant="ghost"
          aria-label="Duplicate test (demo)"
          icon={<Copy className="h-4 w-4" />}
        />
      </Specimen>
      <Specimen caption="active" note="Enabled, then disabled — 40% opacity.">
        <IconButton
          variant="active"
          aria-label="Isolate selected layer"
          icon={<Eye className="h-4 w-4" />}
        />
        <IconButton
          disabled
          variant="active"
          aria-label="Isolate layer (none selected)"
          icon={<Eye className="h-4 w-4" />}
        />
      </Specimen>
    </div>
  );
}

export function HatchPassCluster() {
  return (
    <div className="flex flex-col gap-2 max-w-[420px]">
      <PassRow index={1} angle={45} first />
      <PassRow index={2} angle={135} />
      <PassRow index={3} angle={90} last />
    </div>
  );
}

export function PreviewToolbar() {
  return (
    <div className="max-w-[420px] rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
          Design
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Zoom out"
            icon={<ZoomOut className="h-3.5 w-3.5" />}
          />
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Zoom in"
            icon={<ZoomIn className="h-3.5 w-3.5" />}
          />
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Reset view"
            icon={<RotateCcw className="h-3.5 w-3.5" />}
          />
          <IconButton
            size="sm"
            variant="active"
            aria-label="Show all layers"
            title="Show all layers"
            icon={<Eye className="h-3.5 w-3.5" />}
          />
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
        3 layers · 1 isolated · 1064nm
      </p>
    </div>
  );
}
