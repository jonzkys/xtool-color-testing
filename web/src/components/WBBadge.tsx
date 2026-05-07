import type { ResultWBState } from "../types";
import { Badge, type BadgeProps } from "../ui";

type Variant = NonNullable<BadgeProps["variant"]>;

const TONE: Record<string, { variant: Variant; label: string }> = {
  flatfield:    { variant: "success",     label: "WB · FLATFIELD" },
  chromaticity: { variant: "warning",     label: "WB · CHROMA" },
  skipped:      { variant: "destructive", label: "WB · SKIPPED" },
  disabled:     { variant: "neutral",     label: "WB · DISABLED" },
};

/**
 * Compact status pill that surfaces the WB-correction mode applied
 * during result ingestion. Five states map to distinct tones so an
 * operator can tell at a glance whether a capture was flat-field
 * corrected, fell back to chromaticity-only, was skipped, calibration
 * was disabled, or the field is absent altogether (legacy rows).
 */
export function WBBadge({
  wb,
  size,
  className,
}: {
  wb: ResultWBState | null | undefined;
  size?: BadgeProps["size"];
  className?: string;
}) {
  const mode = wb?.mode ?? null;
  const cfg = mode != null
    ? TONE[mode] ?? { variant: "neutral" as Variant, label: `WB · ${mode.toUpperCase()}` }
    : { variant: "neutral" as Variant, label: "WB · UNKNOWN" };
  return (
    <Badge variant={cfg.variant} size={size} className={className}>
      {cfg.label}
    </Badge>
  );
}
