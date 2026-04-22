import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "./cn";

const badgeStyles = cva(
  [
    "inline-flex items-center gap-1",
    "rounded-full px-2 py-0.5",
    "text-[11px] font-medium",
    "whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        neutral: "bg-[color:var(--color-surface-elevated)] text-[color:var(--color-ink-muted)] border border-[color:var(--color-border-strong)]",
        accent: "bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)] border border-[color:var(--color-primary)]/30",
        info: "bg-[color:var(--color-secondary-tint)] text-[color:var(--color-secondary)] border border-[color:var(--color-secondary)]/25",
        success: "bg-[color:var(--color-success-tint)] text-[color:var(--color-success)] border border-[color:var(--color-success)]/25",
        warning: "bg-[color:var(--color-warning-tint)] text-[color:var(--color-warning)] border border-[color:var(--color-warning)]/30",
        destructive: "bg-[color:var(--color-destructive-tint)] text-[color:var(--color-destructive)] border border-[color:var(--color-destructive)]/25",
      },
      size: {
        sm: "text-[10px] px-1.5 py-[1px]",
        md: "text-[11px] px-2 py-0.5",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
    },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeStyles>;

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeStyles({ variant, size }), className)} {...props} />;
}
