// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StabilityPage } from "./StabilityPage";

beforeEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "#/stability";
});

function mockFetch(map: Record<string, () => Response | Promise<Response>>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
    const path = typeof url === "string" ? url : (url as Request).url;
    for (const key of Object.keys(map)) {
      if (path.includes(key)) return map[key]();
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch);
}

describe("StabilityPage", () => {
  it("renders the empty state when no validation tests exist", async () => {
    mockFetch({
      "/api/materials": () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/api/tests": () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    render(<StabilityPage />);
    // Page header still renders.
    expect(
      await screen.findByText(/Where does my burn drift\?/i),
    ).toBeInTheDocument();
    // Picker rail surfaces the no-validation-tests EmptyState.
    await waitFor(() =>
      expect(screen.getByText(/No validation tests/i)).toBeInTheDocument(),
    );
    // Chart canvas is in its empty state — "Select one or more results
    // to compare" is the brief-mandated hint.
    expect(
      screen.getByText(/Select one or more results to compare/i),
    ).toBeInTheDocument();
    // Stats column is empty.
    expect(screen.getByText(/No results selected/i)).toBeInTheDocument();
  });

  it("loads a validation test and lists its results", async () => {
    const test = {
      id: 1,
      machine_id: "F2Ultra",
      name: "Demo validation",
      material_id: 1,
      status: "tested",
      kind: "validation",
      spec: {
        x_param: "power",
        x_min: 1,
        x_max: 1,
        x_steps: 1,
        y_param: null,
        y_min: null,
        y_max: null,
        y_steps: null,
        rows: 1,
        width_mm: 10,
        height_mm: 10,
        gap_mm: 0,
        cell_shape: "rect",
        sample_aggregator: null,
        square_cells: true,
        angle_mode: "fixed",
        crosshatch: false,
        unidirectional: false,
        hide_axis_labels: true,
        cells_per_row: 2,
        base_params: {
          power: 1,
          speed: 1,
          frequency: 1,
          density: 1,
          passes: 1,
          pulse_width: 1,
          laser: "red",
          scan_angle: 90,
        },
        registration: { mode: "off", qr_size_mm: null, aruco_size_mm: null },
      },
      validation_cells: [
        {
          id: 11,
          test_id: 1,
          cell_index: 0,
          palette_entry_id: null,
          expected_hex: "#aa3322",
          expected_lab: [40, 40, 30],
          params: {},
        },
        {
          id: 12,
          test_id: 1,
          cell_index: 1,
          palette_entry_id: null,
          expected_hex: "#226688",
          expected_lab: [40, -10, -30],
          params: {},
        },
      ],
      notes: "",
      created_at: "2026-04-30T14:20:00Z",
      updated_at: "2026-04-30T14:20:00Z",
      locked: false,
      retest_index: 0,
      ingested: false,
    };
    const result = {
      id: 99,
      test_id: 1,
      uploaded_at: "2026-05-01T08:00:00Z",
      image_url: "",
      image_sha256: "",
      excluded: false,
      notes: "",
      swatches: [
        {
          row: 0,
          col: 0,
          x_value: 0,
          y_value: null,
          hex: "#aa3320",
          lab: [41, 41, 31],
          sigma: 0.5,
        },
        {
          row: 0,
          col: 1,
          x_value: 0,
          y_value: null,
          hex: "#226686",
          lab: [40, -11, -31],
          sigma: 0.5,
        },
      ],
    };
    mockFetch({
      "/api/materials": () =>
        new Response(JSON.stringify([{ id: 1, name: "Brass", notes: "", created_at: "2026-04-01T00:00:00Z", is_default: false }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      // ``listResults`` already carries swatches; the page seeds the
      // cache from this response and skips a per-id round-trip.
      "/api/tests/1/results": () =>
        new Response(JSON.stringify([result]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/api/tests/1": () =>
        new Response(JSON.stringify(test), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/api/tests": () =>
        new Response(JSON.stringify([test]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      "/api/results/99": () =>
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    render(<StabilityPage />);
    // Test surfaces in the picker (and the page header).
    const matches = await screen.findAllByText(/Demo validation/i);
    expect(matches.length).toBeGreaterThan(0);
    // The most-recent result auto-ticks; once it hydrates the chart
    // shows axis selectors (default Δ hue + expected hue) and the
    // stats card lists a mean-Δ summary.
    await waitFor(() => {
      const pillMatches = screen.getAllByText(/Δh°/i);
      expect(pillMatches.length).toBeGreaterThan(0);
    });
    await waitFor(() =>
      expect(screen.getByText(/Mean Δ/i)).toBeInTheDocument(),
    );
  });
});
