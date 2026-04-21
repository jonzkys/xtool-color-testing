import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

const buttonStyles = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[6px] font-medium transition-colors",
    "disabled:pointer-events-none disabled:opacity-40",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-bg)]",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-[color:var(--color-primary)] text-white",
          "hover:bg-[color:var(--color-primary-hover)]",
          "shadow-[0_1px_0_rgba(20,10,0,0.05)]",
        ],
        secondary: [
          "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
          "border border-[color:var(--color-border-strong)]",
          "hover:bg-[color:var(--color-surface-elevated)] hover:border-[color:var(--color-ink-subtle)]",
        ],
        ghost: [
          "bg-transparent text-[color:var(--color-ink)]",
          "hover:bg-[color:var(--color-surface-elevated)]",
        ],
        destructive: [
          "bg-[color:var(--color-destructive)] text-white",
          "hover:bg-[#7F1B28]",
        ],
        link: [
          "bg-transparent text-[color:var(--color-secondary)] underline-offset-2",
          "hover:underline px-0 h-auto",
        ],
      },
      size: {
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-9 px-3.5 text-[13px]",
        lg: "h-10 px-4 text-[14px]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonStyles({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
