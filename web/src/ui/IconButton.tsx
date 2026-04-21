import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

const iconButtonStyles = cva(
  [
    "inline-flex items-center justify-center",
    "rounded-[6px] transition-colors",
    "disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-bg)]",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-[color:var(--color-surface)] text-[color:var(--color-ink-muted)]",
          "border border-[color:var(--color-border-strong)]",
          "hover:text-[color:var(--color-ink)] hover:border-[color:var(--color-ink-subtle)]",
        ],
        ghost: [
          "bg-transparent text-[color:var(--color-ink-muted)]",
          "hover:bg-[color:var(--color-surface-elevated)] hover:text-[color:var(--color-ink)]",
        ],
        active: [
          "bg-[color:var(--color-primary-tint)] text-[color:var(--color-primary)]",
          "border border-[color:var(--color-primary)]",
        ],
      },
      size: {
        sm: "h-7 w-7",
        md: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  VariantProps<typeof iconButtonStyles> & {
    icon: ReactNode;
    /** Accessible label — required since IconButton has no visible text. */
    "aria-label": string;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, icon, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonStyles({ variant, size }), className)}
      {...props}
    >
      {icon}
    </button>
  ),
);
IconButton.displayName = "IconButton";
