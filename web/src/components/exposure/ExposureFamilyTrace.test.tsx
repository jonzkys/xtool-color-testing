import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ExposureFamilyTrace } from "./ExposureFamilyTrace";

describe("ExposureFamilyTrace", () => {
  it("renders a polyline through the given points", () => {
    const points: [number, number][] = [
      [10, 50], [50, 30], [100, 10],
    ];
    const { container } = render(
      <svg width="200" height="100"><ExposureFamilyTrace points={points} /></svg>,
    );
    const line = container.querySelector('[data-role="family-trace"]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute("points")).toBe("10,50 50,30 100,10");
  });

  it("renders nothing when fewer than 2 points", () => {
    const { container } = render(
      <svg><ExposureFamilyTrace points={[[10, 20]]} /></svg>,
    );
    expect(container.querySelector('[data-role="family-trace"]')).toBeNull();
  });
});
