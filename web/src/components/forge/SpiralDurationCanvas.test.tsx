import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpiralDurationCanvas } from "./SpiralDurationCanvas";
import { SPIRAL_CUT } from "../../lib/forge/presets";
import { STAGE_GROUPS } from "../../lib/forge/config";
import type { GeneratedPath, Pt } from "../../lib/forge/types";

function mkPath(groupName: string, len: number): GeneratedPath {
  const pts: Pt[] = [{ x: 0, y: 0 }, { x: len, y: 0 }, { x: len, y: len }];
  return {
    sourceObjectId: "o", generatedClass: "spiral", groupName,
    layerStart: 0, layerEnd: 1, widthMultiplier: 1, offsetMm: 0.8,
    sideMode: "outside", operationOrder: 0, enabled: true, rings: [pts],
  };
}

describe("SpiralDurationCanvas", () => {
  it("renders the legend when there are paths", () => {
    const paths = [mkPath(STAGE_GROUPS.spiral, 100), mkPath(STAGE_GROUPS.spiralDetail, 6)];
    render(<SpiralDurationCanvas paths={paths} config={SPIRAL_CUT} width={300} height={200} />);
    expect(screen.getByText(/time \/ feature/i)).toBeInTheDocument();
    expect(screen.queryByText(/no cut paths/i)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no spiral paths", () => {
    render(<SpiralDurationCanvas paths={[]} config={SPIRAL_CUT} width={300} height={200} />);
    expect(screen.getByText(/no cut paths/i)).toBeInTheDocument();
  });
});
