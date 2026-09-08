import type { ReactNode } from "react";
import { BookOpen, UploadCloud } from "lucide-react";
import { Button, MetalBar, ThemeToggle } from "xcs-gen-web";

function TopBarChip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] border border-[color:var(--color-border)] bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-muted)]">
      {children}
      <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]">
        {label}
      </span>
    </span>
  );
}

export function TopBarRow() {
  return (
    <div className="w-full max-w-[640px]">
      <div className="flex items-center gap-6 h-14 px-4 bg-[color:var(--color-surface)] border-b border-[color:var(--color-border)]">
        <div className="flex flex-col">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-primary)]">
            xcs-gen
          </span>
          <span className="font-mono text-[11px] text-[color:var(--color-ink-subtle)]">
            F2 Ultra · Brass 3.0mm
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <TopBarChip label="Guide">
            <BookOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
          </TopBarChip>
          <TopBarChip label="Upload">
            <UploadCloud className="h-3.5 w-3.5" strokeWidth={1.75} />
          </TopBarChip>
          <ThemeToggle />
        </div>
      </div>
      <MetalBar />
    </div>
  );
}

export function StandaloneHeaderRow() {
  return (
    <div className="w-full max-w-[640px]">
      <div className="flex items-center gap-3 h-14 px-4 bg-[color:var(--color-surface)]">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-ink-subtle)]">
          Relief · depth maps
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <span
            aria-hidden="true"
            className="h-6 w-px bg-[color:var(--color-border-strong)]"
          />
          <Button variant="secondary" size="sm">
            Main App
          </Button>
        </div>
      </div>
      <MetalBar variant="soft" />
      <p className="mt-3 px-4 text-[13px] text-[color:var(--color-ink-muted)]">
        The toggle cycles light → dark → system and persists the choice; the
        chosen mode is applied by toggling <code className="font-mono text-[12px]">.dark</code> on
        the document root.
      </p>
    </div>
  );
}
