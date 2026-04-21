import { type ReactNode } from "react";
import { cn } from "./cn";
import { HelpTooltip } from "./HelpTooltip";

export interface FieldProps {
  label?: ReactNode;
  help?: ReactNode;
  error?: string;
  /** Optional hint shown under the input in muted type. Overridden by error. */
  hint?: ReactNode;
  className?: string;
  /** Render label inline (label | input) rather than stacked. */
  inline?: boolean;
  children: ReactNode;
}

/**
 * Wrapper that standardises the label / help icon / error affordance around
 * any form control (Input, NumberField, Select, Textarea). Replaces the
 * previous ad-hoc per-field markup.
 */
export function Field({ label, help, error, hint, className, inline, children }: FieldProps) {
  if (inline) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        {label !== undefined && (
          <label className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--color-ink-muted)] min-w-0">
            <span className="truncate">{label}</span>
            {help && <HelpTooltip>{help}</HelpTooltip>}
          </label>
        )}
        <div className="flex-1 min-w-0">
          {children}
          {(error || hint) && (
            <p
              className={cn(
                "mt-1 text-[11px]",
                error
                  ? "text-[color:var(--color-destructive)]"
                  : "text-[color:var(--color-ink-subtle)]",
              )}
            >
              {error ?? hint}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("block", className)}>
      {label !== undefined && (
        <label className="flex items-center gap-1.5 mb-1 text-[12.5px] font-medium text-[color:var(--color-ink-muted)]">
          <span>{label}</span>
          {help && <HelpTooltip>{help}</HelpTooltip>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <p
          className={cn(
            "mt-1 text-[11px]",
            error
              ? "text-[color:var(--color-destructive)]"
              : "text-[color:var(--color-ink-subtle)]",
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
