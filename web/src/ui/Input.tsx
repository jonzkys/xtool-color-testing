import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  /** Render the value in JetBrains Mono for numeric/technical input. */
  mono?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, mono, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "block w-full h-9 rounded-[6px] px-3 text-[13px]",
        "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
        "border transition-colors",
        "border-[color:var(--color-border-strong)]",
        "hover:border-[color:var(--color-ink-subtle)]",
        "focus:outline-none focus:border-[color:var(--color-primary)] focus:ring-2 focus:ring-[color:var(--color-primary-tint)]",
        "placeholder:text-[color:var(--color-ink-subtle)]",
        "disabled:opacity-50 disabled:bg-[color:var(--color-bg)]",
        invalid && "border-[color:var(--color-destructive)] ring-2 ring-[color:var(--color-destructive-tint)]",
        mono && "font-mono tabular-nums",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
