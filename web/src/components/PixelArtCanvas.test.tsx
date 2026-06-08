import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PixelArtCanvas, type PreviewState, type PreviewShape } from "./PixelArtCanvas";

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
        previewMode="representative"
        onPreviewModeChange={() => {}}
        previewView="fill"
        onPreviewViewChange={() => {}}
        shapes={null}
        lockAspect={false}
        cropEnabled={false}
        onCropEnabledChange={() => {}}
      />,
    );
    expect(screen.getByText(/upload an image/i)).toBeInTheDocument();
    expect(screen.getByText(/preview appears once/i)).toBeInTheDocument();
  });

  it("renders the bottom preview canvas when preview is non-null", () => {
    const cellCentroidHex: (string | null)[] = new Array(16).fill(null);
    cellCentroidHex[0] = "#ff0000";
    cellCentroidHex[1] = "#ff0000";
    cellCentroidHex[2] = "#00ff00";
    const preview: PreviewState = {
      cols: 4,
      rows: 4,
      pathCount: 2,
      kColors: 2,
      cellCentroidHex,
      cellMeansHex: new Array(16).fill(null),
    };
    const { container } = render(
      <PixelArtCanvas
        image={null}
        materialWidthMm={50}
        materialHeightMm={50}
        crop={{ x: 0, y: 0, w: 1, h: 1 }}
        onCropChange={() => {}}
        preview={preview}
        previewMode="representative"
        onPreviewModeChange={() => {}}
        previewView="fill"
        onPreviewViewChange={() => {}}
        shapes={null}
        lockAspect={false}
        cropEnabled={false}
        onCropEnabledChange={() => {}}
      />,
    );
    // The bottom preview canvas is present once the preview state
    // hydrates. (The top canvas only mounts when an image is loaded
    // — null in this test, so we only see one.)
    const canvases = container.querySelectorAll("canvas");
    expect(canvases.length).toBe(1);
    expect(screen.getByText(/4×4 cells/)).toBeInTheDocument();
    expect(screen.getByText(/2 paths/)).toBeInTheDocument();
  });
});

const previewSV: PreviewState = {
  cols: 2,
  rows: 1,
  cellCentroidHex: ["#000000", "#000000"],
  pathCount: 1,
  kColors: 1,
  cellMeansHex: ["#000000", "#000000"],
};

const shapesSV: PreviewShape[] = [
  { color: "#000000", loops: [[[0, 0], [2, 0], [2, 1], [0, 1]]] },
];

function renderCanvas(view: "fill" | "shapes") {
  return render(
    <PixelArtCanvas
      image={null}
      materialWidthMm={10}
      materialHeightMm={10}
      crop={{ x: 0, y: 0, w: 1, h: 1 }}
      onCropChange={() => {}}
      preview={previewSV}
      previewMode="representative"
      onPreviewModeChange={() => {}}
      previewView={view}
      onPreviewViewChange={() => {}}
      shapes={shapesSV}
      lockAspect={false}
      cropEnabled={false}
      onCropEnabledChange={() => {}}
    />,
  );
}

describe("PixelArtCanvas shapes view", () => {
  it("hides the outline overlay in fill view", () => {
    renderCanvas("fill");
    expect(screen.queryByLabelText("merged shape outlines")).toBeNull();
  });

  it("renders the outline overlay in shapes view", () => {
    renderCanvas("shapes");
    expect(screen.getByLabelText("merged shape outlines")).toBeTruthy();
  });
});
