import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PixelArtCanvas, type PreviewState } from "./PixelArtCanvas";

describe("PixelArtCanvas", () => {
  it("renders a placeholder strip when no image is supplied", () => {
    render(
      <PixelArtCanvas
        image={null}
        materialWidthMm={50}
        materialHeightMm={50}
        crop={{ x: 0, y: 0, w: 1, h: 1 }}
        onCropChange={() => {}}
        preview={null}
      />,
    );
    expect(screen.getByText(/upload an image/i)).toBeInTheDocument();
    expect(screen.getByText(/preview appears once/i)).toBeInTheDocument();
  });

  it("renders one rect per CoverRect when preview is non-null", () => {
    const preview: PreviewState = {
      cols: 4,
      rows: 4,
      rectCount: 3,
      kColors: 2,
      rects: [
        { x: 0, y: 0, width: 2, height: 2, color: "#ff0000" },
        { x: 2, y: 0, width: 2, height: 2, color: "#00ff00" },
        { x: 0, y: 2, width: 4, height: 2, color: "#0000ff" },
      ],
    };
    const { container } = render(
      <PixelArtCanvas
        image={null}
        materialWidthMm={50}
        materialHeightMm={50}
        crop={{ x: 0, y: 0, w: 1, h: 1 }}
        onCropChange={() => {}}
        preview={preview}
      />,
    );
    const rects = container.querySelectorAll("svg rect");
    expect(rects.length).toBe(3);
    expect(screen.getByText(/4×4 cells/)).toBeInTheDocument();
    expect(screen.getByText(/3 rects after merge/)).toBeInTheDocument();
  });
});
