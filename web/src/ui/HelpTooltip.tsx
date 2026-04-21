import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";
import { cn } from "./cn";

export interface HelpTooltipProps {
  children: ReactNode;
  /** Optional custom trigger; defaults to a "?" icon. */
  trigger?: ReactNode;
  className?: string;
}

/**
 * Help tooltip built on Radix — escapes scroll parents via its portal, so
 * it replaces the hand-rolled `.help-icon / .help-tip` mechanism in most of
 * the app. `NumberField` keeps the legacy behaviour because its tooltip
 * needs specific fixed-position logic we haven't re-validated against Radix.
 */
export function HelpTooltip({ children, trigger, className }: HelpTooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {trigger ?? (
            <button
              type="button"
              aria-label="Help"
              className={cn(
                "inline-flex items-center justify-center",
                "w-3.5 h-3.5 rounded-full text-[10px] font-bold",
                "text-[color:var(--color-ink-subtle)] bg-[color:var(--color-surface)]",
                "border border-[color:var(--color-border-strong)]",
                "hover:text-[color:var(--color-primary)] hover:border-[color:var(--color-primary)]",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]",
              )}
            >
              ?
            </button>
          )}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "max-w-[280px] z-50 rounded-md px-3 py-2",
              "bg-[color:var(--color-ink)] text-[color:var(--color-bg)]",
              "text-[12px] leading-[1.45] font-normal",
              "shadow-[var(--shadow-popover)]",
              "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
              className,
            )}
          >
            {children}
            <TooltipPrimitive.Arrow className="fill-[color:var(--color-ink)]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
