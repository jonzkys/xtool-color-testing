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

  it("renders one path per enabled colour when preview is non-null", () => {
    const preview: PreviewState = {
      cols: 4,
      rows: 4,
      pathCount: 2,
      kColors: 2,
      paths: [
        { d: "M0,0 h1 v1 h-1 z M1,0 h1 v1 h-1 z", color: "#ff0000" },
        { d: "M2,0 h1 v1 h-1 z", color: "#00ff00" },
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
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBe(2);
    expect(screen.getByText(/4×4 cells/)).toBeInTheDocument();
    expect(screen.getByText(/2 paths/)).toBeInTheDocument();
  });
});
