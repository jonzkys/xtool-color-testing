import { cn } from "../ui";
import type { OutputFormat } from "../types";

/** Per-format hover copy; unknown formats fall back to a generic label. */
const FORMAT_TITLE: Record<string, string> = {
  xs: "Download as .xs (ZIP — the new default)",
  xcs: "Download as legacy .xcs",
  svg: "Download as .svg (vector cut outlines)",
};

export interface FormatToggleProps<T extends string = OutputFormat> {
  value: T;
  onChange: (format: T) => void;
  /** Selectable formats, in display order. Defaults to .xs / .xcs. */
  formats?: readonly T[];
  /** Disable the whole control (e.g. while a download is in flight). */
  disabled?: boolean;
  /** Extra classes for the outer segmented container. */
  className?: string;
  /** Compact variant (h-7) to sit inline with `size="sm"` buttons. */
  size?: "sm" | "md";
}

/**
 * FormatToggle — segmented output-format control (`.xs / .xcs`, plus `.svg`
 * where a page offers it). JetBrains Mono uppercase tracking, ember-primary
 * active segment. Default selection is `.xs` (the parent owns state and should
 * seed it with `DEFAULT_OUTPUT_FORMAT`).
 */
export function FormatToggle<T extends string = OutputFormat>({
  value,
  onChange,
  formats,
  disabled,
  className,
  size = "md",
}: FormatToggleProps<T>) {
  const opts = formats ?? (["xs", "xcs"] as unknown as readonly T[]);
  return (
    <div
      role="radiogroup"
      aria-label="Output format"
      title="Choose the download format"
      className={cn(
        "inline-flex items-stretch rounded-[6px] border border-[color:var(--color-border)] overflow-hidden",
        disabled && "opacity-50",
        className,
      )}
    >
      {opts.map((fmt) => {
        const active = value === fmt;
        return (
          <button
            key={fmt}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(fmt)}
            title={FORMAT_TITLE[fmt] ?? `Download as .${fmt}`}
            className={cn(
              "font-mono tracking-[0.16em] uppercase font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50 focus-visible:ring-inset",
              size === "sm" ? "px-2 py-1 text-[9.5px]" : "px-2.5 py-1.5 text-[10px]",
              active
                ? "bg-[color:var(--color-primary)] text-white"
                : "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)] hover:bg-[color:var(--color-surface-elevated)]",
              disabled && "cursor-not-allowed",
            )}
          >
            .{fmt}
          </button>
        );
      })}
    </div>
  );
}
