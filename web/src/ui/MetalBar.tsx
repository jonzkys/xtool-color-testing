import { cn } from "./cn";

export interface MetalBarProps {
  /** Full-strength vs soft variant. Soft is for in-page dividers. */
  variant?: "default" | "soft";
  className?: string;
}

/**
 * 1-px metallic gradient strip — the recurring visual signature.
 * Used under the TopBar, under Section labels, and under active tabs.
 */
export function MetalBar({ variant = "default", className }: MetalBarProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("h-px w-full", className)}
      style={{
        background: variant === "soft" ? "var(--metal-bar-soft)" : "var(--metal-bar)",
      }}
    />
  );
}
