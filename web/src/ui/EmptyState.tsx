import { type ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "px-8 py-16 gap-3",
        "text-[color:var(--color-ink-muted)]",
        className,
      )}
    >
      {icon && <div className="text-[color:var(--color-ink-subtle)]">{icon}</div>}
      {title && (
        <h4 className="text-[14px] font-semibold text-[color:var(--color-ink)]">{title}</h4>
      )}
      {description && (
        <p className="max-w-[360px] text-[13px] leading-relaxed text-[color:var(--color-ink-muted)]">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
