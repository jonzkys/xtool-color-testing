import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PixelArtLayerPanel, type PixelArtLayerRow } from "./PixelArtLayerPanel";
import { defaultBaseParams } from "../defaults";
import type { LibraryState } from "../library";

const baseLibrary: LibraryState = {
  materials: [],
  presets: [],
  active_material_id: null,
};

const baseProps = {
  paletteEntries: [],
  library: baseLibrary,
  onToggle: () => {},
  onChooseMatch: () => {},
  onConfirmMerge: () => {},
  onRematchAll: () => {},
  onDownloadXcs: () => {},
  onDownloadSvg: () => {},
  outputFormat: "xs" as const,
  onOutputFormatChange: () => {},
  mergeEnabled: true,
  onMergeEnabledChange: () => {},
};

function row(color: string, areaPct: number, enabled = true): PixelArtLayerRow {
  return {
    color,
    enabled,
    areaPct,
    cellCount: Math.max(1, Math.round(areaPct * 1000)),
    isNearWhite: false,
    matchedEntry: null,
    baseParams: defaultBaseParams(),
    materialId: null,
  };
}

describe("PixelArtLayerPanel", () => {
  it("renders an empty-state pill when no rows are supplied", () => {
    render(<PixelArtLayerPanel {...baseProps} rows={[]} />);
    expect(screen.getByText(/no colours yet/i)).toBeInTheDocument();
  });

  it("renders one row per centroid sorted by area pct desc", () => {
    const rows = [
      row("#aaaaaa", 0.1),
      row("#ff0000", 0.5),
      row("#00ff00", 0.3),
    ];
    const { container } = render(<PixelArtLayerPanel {...baseProps} rows={rows} />);
    // Compact tiles render one ``<li>`` per centroid; each tile has
    // 2 aria-hidden colour swatches inside (detected + matched).
    const tiles = container.querySelectorAll("ul li");
    expect(tiles.length).toBe(3);
    // header strip shows 3/3 enabled
    expect(screen.getByText(/Colours · 3\/3/)).toBeInTheDocument();
  });

  it("disables the project / .svg downloads when every colour is turned off", () => {
    const rows = [row("#ff0000", 0.6, false), row("#00ff00", 0.4, false)];
    render(<PixelArtLayerPanel {...baseProps} rows={rows} />);
    // The project-download button is labelled with the chosen format
    // (".xs" by default). The format toggle's own entries are radios,
    // not buttons, so this name only matches the download button.
    expect(screen.getByRole("button", { name: /\.xs/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /\.svg/ })).toBeDisabled();
  });

  it("renders the .xs / .xcs output-format toggle (default .xs)", () => {
    render(<PixelArtLayerPanel {...baseProps} rows={[row("#ff0000", 1)]} />);
    const xs = screen.getByRole("radio", { name: /\.xs/ });
    const xcs = screen.getByRole("radio", { name: /\.xcs/ });
    expect(xs).toHaveAttribute("aria-checked", "true");
    expect(xcs).toHaveAttribute("aria-checked", "false");
  });

  it("shows the path-count badge equal to enabled colours", () => {
    const rows = [
      row("#aaaaaa", 0.5),
      row("#bbbbbb", 0.3),
      row("#cccccc", 0.2, false),
    ];
    render(<PixelArtLayerPanel {...baseProps} rows={rows} />);
    // Two enabled rows → "2 paths" pill in the section header.
    expect(screen.getByText(/2 paths/)).toBeInTheDocument();
  });
});
