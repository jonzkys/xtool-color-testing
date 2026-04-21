import type { TestSpec } from "../types";

export function TestPreview({ spec }: { spec: TestSpec; testId: number | null }) {
  return <div style={{ color: "#888" }}>Preview — {spec.width_mm}×{spec.height_mm} mm</div>;
}
