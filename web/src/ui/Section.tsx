import { type ReactNode } from "react";
import { cn } from "./cn";

export interface SectionProps {
  title?: ReactNode;
  /** Optional right-aligned slot for actions (e.g. "+ Add preset"). */
  actions?: ReactNode;
  /** Small subhead rendered below the title. */
  description?: ReactNode;
  /** Drop the metallic underline (use in dense adjacent sections). */
  dense?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Visual grouping with an uppercase-tracked label and a thin metallic
 * divider beneath. Replaces the previous ad-hoc Section helper.
 * The metal strip is the recurring visual signature of the design.
 */
export function Section({
  title,
  actions,
  description,
  dense,
  className,
  children,
}: SectionProps) {
  return (
    <section className={cn("flex flex-col", className)}>
      {(title || actions) && (
        <header className={cn("flex items-end justify-between gap-3", dense ? "mb-2" : "mb-3")}>
          <div className="flex-1 min-w-0">
            {title && (
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
                {title}
              </div>
            )}
            {description && (
              <p className="mt-1 text-[12px] text-[color:var(--color-ink-muted)]">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {!dense && (
        <div
          aria-hidden="true"
          className="h-px w-full mb-3"
          style={{ background: "var(--metal-bar-soft)" }}
        />
      )}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
