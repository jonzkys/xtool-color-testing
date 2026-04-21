import { type ReactNode } from "react";
import { cn } from "./cn";

export interface PageContainerProps {
  /** default = 1280, wide = 1440 (SVG Layers only), full = no max. */
  maxWidth?: "default" | "wide" | "full";
  /** Disable the default px-8 horizontal padding (for full-bleed layouts). */
  bleed?: boolean;
  className?: string;
  children: ReactNode;
}

export function PageContainer({
  maxWidth = "default",
  bleed,
  className,
  children,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        !bleed && "px-6 md:px-8",
        maxWidth === "default" && "max-w-[1280px]",
        maxWidth === "wide" && "max-w-[1440px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
