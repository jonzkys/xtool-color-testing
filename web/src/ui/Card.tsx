import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** Visual weight — `inset` uses the page's warm bg colour, useful for
   *  preview panels where the content is the star. */
  variant?: "default" | "elevated" | "inset";
  padded?: boolean;
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", padded = true, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[10px] border border-[color:var(--color-border)]",
        variant === "default" && "bg-[color:var(--color-surface)] shadow-[var(--shadow-card)]",
        variant === "elevated" && "bg-[color:var(--color-surface-elevated)] shadow-[var(--shadow-card)]",
        variant === "inset" && "bg-[color:var(--color-bg)]",
        padded && "p-4",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "-mx-4 -mt-4 mb-4 px-4 py-3 border-b border-[color:var(--color-border)]",
        "flex items-center gap-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h3 className={cn("text-[14px] font-semibold text-[color:var(--color-ink)]", className)}>
      {children}
    </h3>
  );
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "-mx-4 -mb-4 mt-4 px-4 py-3 border-t border-[color:var(--color-border)]",
        "flex items-center justify-end gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
