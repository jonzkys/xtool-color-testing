import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResultDetailDialog } from "./ResultDetailDialog";

// Stub the authed-image hook so the test doesn't drive the photo
// fetch — that path produces a Blob whose .stream() method isn't
// reliably available on CI's Node, and the photo isn't what we're
// testing here.
vi.mock("../hooks/useAuthedImage", () => ({
  useAuthedImage: () => null,
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const baseResult = {
  id: 1, test_id: 1, uploaded_at: "2026-04-26T10:00:00Z",
  image_url: "/api/results/1/image", image_sha256: "x",
  excluded: false, notes: "",
  swatches: [{ row: 0, col: 0, x_value: 50, y_value: null,
               hex: "#ff0000", lab: [50, 80, 70], sigma: 0 }],
  retest_index: 0, missing_markers: [],
};

const baseTest = {
  id: 1, name: "T", material_id: 1, status: "tested",
  notes: "", created_at: "", updated_at: "",
  locked: true, owner_id: 1, visibility: "private",
  machine_id: "F2Ultra",
  spec: {
    x_param: "frequency", x_min: 50, x_max: 200, x_steps: 9,
    rows: 1, width_mm: 23, height_mm: 23,
    cell_shape: "circle",
    sample_aggregator: "saturation_median",
    base_params: {}, registration: { mode: "on" },
  },
};

describe("ResultDetailDialog aggregator dropdown", () => {
  it("calls previewSwatches when the aggregator changes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
      const u = String(url);
      if (u.endsWith("/api/tests/1")) {
        return Promise.resolve(new Response(
          JSON.stringify(baseTest),
          { status: 200, headers: { "content-type": "application/json" } },
        ));
      }
      if (u.includes("/api/results/1/swatches/preview?aggregator=mean")) {
        return Promise.resolve(new Response(
          JSON.stringify({
            aggregator: "mean",
            swatches: [{ row: 0, col: 0, x_value: 50, y_value: null,
                         hex: "#00ff00", lab: [60, -50, 40], sigma: 0 }],
          }),
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

    render(<ResultDetailDialog open={true} onOpenChange={() => {}} result={baseResult as any} />);
    const dropdown = await screen.findByLabelText("Aggregator");
    fireEvent.change(dropdown, { target: { value: "mean" } });

    await waitFor(() => {
      const calls = (globalThis.fetch as any).mock.calls.map((c: any) => String(c[0]));
      expect(calls.some((u: string) => u.includes("/swatches/preview?aggregator=mean"))).toBe(true);
    });
  });
});
