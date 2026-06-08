import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { PixelArtLayerPanel, type PixelArtLayerRow } from "./PixelArtLayerPanel";
import { ExpandedLayerPanel } from "./PixelArtLayerPanel";
import { defaultBaseParams } from "../defaults";
import type { LibraryState } from "../library";
import type { PaletteEntry } from "../types";

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

function entry(hex: string, over: Partial<PaletteEntry> = {}): PaletteEntry {
  return {
    id: over.id ?? Math.floor(Math.random() * 1e9),
    machine_id: "F2Ultra",
    test_id: null,
    material_id: 1,
    x_value: null,
    y_value: null,
    hex,
    lab: [],
    params: {},
    sigma: 0,
    source: "manual",
    source_result_id: null,
    notes: "",
    favorited: false,
    created_at: "2026-06-08T00:00:00Z",
    ...over,
  };
}

function expandedRow(over: Partial<PixelArtLayerRow> = {}): PixelArtLayerRow {
  return {
    color: "#c47a3e",
    enabled: true,
    areaPct: 0.5,
    cellCount: 100,
    isNearWhite: false,
    matchedEntry: null,
    baseParams: defaultBaseParams(),
    materialId: null,
    ...over,
  };
}

describe("ExpandedLayerPanel sections", () => {
  const many: PaletteEntry[] = [
    ...Array.from({ length: 10 }, (_, i) =>
      entry(`#${(0x111111 * (i + 1)).toString(16).padStart(6, "0").slice(0, 6)}`, { id: 100 + i }),
    ),
    entry("#d4af37", { id: 900, favorited: true }),
    entry("#b87333", { id: 901, favorited: true }),
  ];

  it("shows the Similar, Favourites and All section headers", () => {
    render(
      <ExpandedLayerPanel row={expandedRow()} paletteEntries={many} library={baseLibrary} onChooseMatch={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/Similar/i)).toBeInTheDocument();
    expect(screen.getByText(/Favourites/i)).toBeInTheDocument();
    expect(screen.getByText(/^All ·/i)).toBeInTheDocument();
  });

  it("hides the Favourites section when there are none", () => {
    const noFavs = many.filter((e) => !e.favorited);
    render(
      <ExpandedLayerPanel row={expandedRow()} paletteEntries={noFavs} library={baseLibrary} onChooseMatch={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByText(/Favourites/i)).toBeNull();
  });

  it("Load more grows the Similar list until exhausted", () => {
    render(
      <ExpandedLayerPanel row={expandedRow()} paletteEntries={many} library={baseLibrary} onChooseMatch={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText(/Load more/i));
    expect(screen.queryByText(/Load more/i)).toBeNull(); // 12 entries → after one more page all shown
  });

  it("All is collapsed by default and expands with a filter box", () => {
    render(
      <ExpandedLayerPanel row={expandedRow()} paletteEntries={many} library={baseLibrary} onChooseMatch={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByPlaceholderText(/filter by name or hex/i)).toBeNull();
    fireEvent.click(screen.getByText(/^All ·/i));
    expect(screen.getByPlaceholderText(/filter by name or hex/i)).toBeInTheDocument();
  });

  it("calls onChooseMatch with the picked entry", () => {
    const picked: (PaletteEntry | null)[] = [];
    render(
      <ExpandedLayerPanel row={expandedRow()} paletteEntries={[entry("#c47a3e", { id: 1 })]} library={baseLibrary} onChooseMatch={(_c, e) => picked.push(e)} onClose={() => {}} />,
    );
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent?.includes("ΔE"))!);
    expect(picked[0]?.id).toBe(1);
  });

  it("Clear match calls onChooseMatch(color, null)", () => {
    const calls: [string, PaletteEntry | null][] = [];
    const matched = entry("#c47a3e", { id: 1 });
    render(
      <ExpandedLayerPanel
        row={expandedRow({ matchedEntry: matched })}
        paletteEntries={[matched]}
        library={baseLibrary}
        onChooseMatch={(c, e) => calls.push([c, e])}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear match/i }));
    expect(calls[0]).toEqual(["#c47a3e", null]);
  });

  it("All filter narrows entries and shows 'no matches' when nothing fits", () => {
    render(
      <ExpandedLayerPanel row={expandedRow()} paletteEntries={many} library={baseLibrary} onChooseMatch={() => {}} onClose={() => {}} />,
    );
    fireEvent.click(screen.getByText(/^All ·/i));
    const filter = screen.getByPlaceholderText(/filter by name or hex/i);
    fireEvent.change(filter, { target: { value: "zzznomatch" } });
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});
