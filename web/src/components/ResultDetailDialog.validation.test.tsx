import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ResultDetailDialog } from "./ResultDetailDialog";

// Stub the authed-image hook so the test doesn't drive the photo
// fetch — same reason as ResultDetailDialog.test.tsx.
vi.mock("../hooks/useAuthedImage", () => ({ useAuthedImage: () => null }));

beforeEach(() => {
  vi.restoreAllMocks();
});

const validationResult = {
  id: 1, test_id: 1, uploaded_at: "2026-05-02T10:00:00Z",
  image_url: "/api/results/1/image", image_sha256: "x",
  excluded: false, notes: "",
  swatches: [
    { row: 0, col: 0, x_value: 0, y_value: null,
      hex: "#ff0000", lab: [50, 80, 70], sigma: 1.2 },
    { row: 0, col: 1, x_value: 1, y_value: null,
      hex: "#00ff00", lab: [60, -50, 40], sigma: 0.8 },
  ],
  retest_index: 0, missing_markers: [],
};

const validationTest = {
  id: 1, name: "v", material_id: 1, status: "tested",
  notes: "", created_at: "", updated_at: "",
  locked: true, owner_id: 1, visibility: "private",
  machine_id: "F2Ultra",
  kind: "validation" as const,
  validation_cells: [
    { id: 1, test_id: 1, cell_index: 0,
      palette_entry_id: 10, expected_hex: "#ff0001",
      expected_lab: [51, 79, 69], params: {} },
    { id: 2, test_id: 1, cell_index: 1,
      palette_entry_id: 11, expected_hex: "#00ff10",
      expected_lab: [62, -52, 38], params: {} },
  ],
  spec: {
    x_param: "power", x_min: 0, x_max: 0, x_steps: 2,
    rows: 1, width_mm: 30, height_mm: 30,
    cell_shape: "rect", sample_aggregator: "saturation_median",
    base_params: {}, registration: { mode: "on" }, hide_axis_labels: true,
    cells_per_row: 2,
  },
};

describe("ResultDetailDialog · validation", () => {
  it("renders the validation summary strip when the test is kind=validation", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
      const u = String(url);
      if (u.endsWith("/api/tests/1")) {
        return Promise.resolve(new Response(
          JSON.stringify(validationTest),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (u.includes("/api/health")) {
        return Promise.resolve(new Response(
          JSON.stringify({ status: "ok", mode: "standalone" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      return Promise.reject(new Error("unexpected " + u));
    }) as typeof fetch);

    render(
      <ResultDetailDialog
        open={true}
        onOpenChange={() => {}}
        result={validationResult as any}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/median ΔE/i)).toBeTruthy();
    });
  });
});
