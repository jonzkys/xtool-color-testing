import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "block w-full h-9 rounded-[6px] pl-3 pr-8 text-[13px]",
          "appearance-none bg-[color:var(--color-surface)] text-[color:var(--color-ink)]",
          "border transition-colors",
          "border-[color:var(--color-border-strong)]",
          "hover:border-[color:var(--color-ink-subtle)]",
          "focus:outline-none focus:border-[color:var(--color-primary)] focus:ring-2 focus:ring-[color:var(--color-primary-tint)]",
          "disabled:opacity-50 disabled:bg-[color:var(--color-bg)]",
          invalid && "border-[color:var(--color-destructive)] ring-2 ring-[color:var(--color-destructive-tint)]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--color-ink-subtle)]"
      />
    </div>
  ),
);
Select.displayName = "Select";
