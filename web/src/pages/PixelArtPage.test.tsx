import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Stub network calls so the page renders without hitting the backend.
vi.mock("../api/library", () => ({
  listMaterials: vi.fn().mockResolvedValue([]),
  listPresets: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/palette", () => ({
  listPaletteEntries: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/machines", () => ({
  getMachines: vi.fn().mockResolvedValue({ machines: [], profiles: {} }),
}));

import { PixelArtPage } from "./PixelArtPage";

describe("PixelArtPage", () => {
  it("renders the settings panel and the empty-state placeholders", () => {
    render(<PixelArtPage />);
    // PixelArtCanvas placeholders.
    expect(screen.getByText(/upload an image to begin/i)).toBeInTheDocument();
    // PixelArtLayerPanel empty state.
    expect(screen.getByText(/no colours yet/i)).toBeInTheDocument();
    // Settings sections — pick distinctive copy.
    expect(screen.getByText(/Output name/i)).toBeInTheDocument();
    expect(screen.getByText(/Cells across/i)).toBeInTheDocument();
    expect(screen.getByText(/Max K/i)).toBeInTheDocument();
  });
});
