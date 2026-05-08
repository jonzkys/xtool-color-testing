import * as React from "react";

interface Props {
  /** Pre-projected screen coordinates of family members in
   *  varying-axis order. Caller is responsible for the projection. */
  points: readonly (readonly [number, number])[];
}

/**
 * A faint polyline tracing through a recipe-family's members.
 * Rendered behind the scatter dots, deliberately understated —
 * 1.2 px stroke at 0.4 opacity in the project's ink-subtle token
 * so it reads as a guide line, not a focal element.
 */
export const ExposureFamilyTrace: React.FC<Props> = ({ points }) => {
  if (points.length < 2) return null;
  const d = points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <polyline
      data-role="family-trace"
      points={d}
      fill="none"
      stroke="var(--color-ink-subtle)"
      strokeWidth={1.2}
      strokeOpacity={0.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
};
