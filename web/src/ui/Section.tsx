import { type ReactNode } from "react";
import { cn } from "./cn";

export interface SectionProps {
  title?: ReactNode;
  /** Optional right-aligned slot for actions (e.g. "+ Add preset"). */
  actions?: ReactNode;
  /** Small subhead rendered below the title. */
  description?: ReactNode;
  /** Native ``title`` tooltip on the section header. Use for the
   *  rare longform hint that doesn't justify a permanent
   *  ``description`` row. */
  titleHint?: string;
  /** Drop the metallic underline (use in dense adjacent sections). */
  dense?: boolean;
  className?: string;
  /** Override classes on the inner body wrapper (the ``<div>`` that
   *  hosts ``children``). The default is ``flex flex-col gap-3``;
   *  pass e.g. ``flex-1 min-h-0`` when the body needs to grow into
   *  whatever vertical room the section owns. */
  bodyClassName?: string;
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
  titleHint,
  dense,
  className,
  bodyClassName,
  children,
}: SectionProps) {
  return (
    <section className={cn("flex flex-col", className)}>
      {(title || actions) && (
        <header
          className={cn(
            // ``flex-wrap`` so long ``actions`` content drops onto its own
            // line in narrow columns (e.g. the SVG Layers left sidebar)
            // instead of crushing the description into a vertical stack of
            // letters. ``basis-[180px]`` on the title block reserves enough
            // room for words to break on spaces before wrap kicks in.
            "flex flex-wrap items-end justify-between gap-x-3 gap-y-2",
            dense ? "mb-2" : "mb-3",
          )}
        >
          <div className="flex-1 min-w-0 basis-[180px]">
            {title && (
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]"
                title={titleHint}
              >
                {title}
              </div>
            )}
            {description && (
              <p className="mt-1 text-[12px] text-[color:var(--color-ink-muted)]">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0 ml-auto">{actions}</div>
          )}
        </header>
      )}
      {!dense && (
        <div
          aria-hidden="true"
          className="h-px w-full mb-3"
          style={{ background: "var(--metal-bar-soft)" }}
        />
      )}
      <div className={cn("flex flex-col gap-3", bodyClassName)}>{children}</div>
    </section>
  );
}
