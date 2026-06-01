import { cn } from "../ui";
import type { OutputFormat } from "../types";

/** The selectable output containers, in display order. ``xs`` (the
 *  default / first option) returns a ZIP; ``xcs`` is the legacy
 *  single-file XCS JSON. */
const FORMATS: readonly OutputFormat[] = ["xs", "xcs"] as const;

export interface FormatToggleProps {
  value: OutputFormat;
  onChange: (format: OutputFormat) => void;
  /** Disable the whole control (e.g. while a download is in flight). */
  disabled?: boolean;
  /** Extra classes for the outer segmented container. */
  className?: string;
  /** Compact variant (h-7) to sit inline with `size="sm"` buttons. */
  size?: "sm" | "md";
}

/**
 * FormatToggle — segmented `.xs / .xcs` output-format control.
 *
 * Mirrors the export-colour-source segmented control on the SVG-layers
 * page: JetBrains Mono uppercase tracking, ember-primary active segment.
 * Default selection is `.xs` (the parent owns state and should seed it
 * with `DEFAULT_OUTPUT_FORMAT`).
 */
export function FormatToggle({
  value,
  onChange,
  disabled,
  className,
  size = "md",
}: FormatToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Output format"
      title="Choose the download format — .xs (ZIP, default) or legacy .xcs"
      className={cn(
        "inline-flex items-stretch rounded-[6px] border border-[color:var(--color-border)] overflow-hidden",
        disabled && "opacity-50",
        className,
      )}
    >
      {FORMATS.map((fmt) => {
        const active = value === fmt;
        return (
          <button
            key={fmt}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(fmt)}
            title={
              fmt === "xs"
                ? "Download as .xs (ZIP — the new default)"
                : "Download as legacy .xcs"
            }
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
