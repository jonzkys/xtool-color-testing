import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "block w-full min-h-[64px] rounded-[6px] px-3 py-2 text-[13px]",
        "bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
        "border transition-colors resize-y",
        "border-[color:var(--color-border-strong)]",
        "hover:border-[color:var(--color-ink-subtle)]",
        "focus:outline-none focus:border-[color:var(--color-primary)] focus:ring-2 focus:ring-[color:var(--color-primary-tint)]",
        "placeholder:text-[color:var(--color-ink-subtle)]",
        "disabled:opacity-50 disabled:bg-[color:var(--color-bg)]",
        invalid && "border-[color:var(--color-destructive)] ring-2 ring-[color:var(--color-destructive-tint)]",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
