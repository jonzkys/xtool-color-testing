import { Badge } from "../ui";
import type { ResultWBState } from "../types";

/**
 * Compact pill that surfaces how (or whether) the white-balance pass
 * fired on a result. Lives in the result-detail/debug headers so the
 * user can tell at a glance whether the swatches below were corrected
 * against the calibration strip, fell back to chromaticity-only, or
 * skipped WB entirely.
 *
 * The mode/label/variant mapping leans on the existing semantic
 * Badge tokens — no bespoke colour palette here.
 */
const WB_MODE_VARIANT: Record<
  NonNullable<ResultWBState["mode"]>,
  { variant: "success" | "warning" | "destructive" | "neutral"; label: string }
> = {
  anchored:     { variant: "success",     label: "WB · ANCHORED" },
  chromaticity: { variant: "warning",     label: "WB · CHROMA" },
  skipped:      { variant: "destructive", label: "WB · SKIPPED" },
  disabled:     { variant: "neutral",     label: "WB · DISABLED" },
};

export interface WBBadgeProps {
  wb: ResultWBState | null | undefined;
}

export function WBBadge({ wb }: WBBadgeProps) {
  const mode = wb?.mode ?? null;
  const tone =
    mode != null
      ? WB_MODE_VARIANT[mode]
      : { variant: "neutral" as const, label: "WB · UNKNOWN" };
  return (
    <Badge
      variant={tone.variant}
      size="sm"
      className="font-mono tracking-[0.18em] uppercase"
      title={
        mode === "anchored"
          ? "Anchored WB: per-channel gain + gamma fit from the calibration strip."
          : mode === "chromaticity"
            ? "Chromaticity-only WB: neutral patch matched, but the luminance fit was skipped."
            : mode === "skipped"
              ? "Calibration was attempted but the strip was unusable; raw colours."
              : mode === "disabled"
                ? "WB toggle off for this material; raw colours."
                : "No WB state recorded on this result."
      }
    >
      {tone.label}
    </Badge>
  );
}
