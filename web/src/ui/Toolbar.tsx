import { type ReactNode } from "react";
import { cn } from "./cn";

export interface ToolbarProps {
  /** Primary content, left-aligned. */
  children: ReactNode;
  /** Right-aligned actions. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Horizontal action strip. Used above lists and previews to collect
 * small controls without visual weight.
 */
export function Toolbar({ children, trailing, className }: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">{children}</div>
      {trailing && (
        <div className="ml-auto flex items-center gap-2 shrink-0">{trailing}</div>
      )}
    </div>
  );
}
