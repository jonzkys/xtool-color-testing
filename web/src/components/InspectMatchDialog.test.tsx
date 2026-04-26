import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { InspectMatchDialog } from "./InspectMatchDialog";

beforeEach(() => {
  vi.restoreAllMocks();
});

const fakeResponse = {
  row: 0,
  col: 0,
  x_value: 50,
  y_value: null,
  sigma: 1.5,
  cell_image_b64: "iVBORw0KGgo=", // tiny placeholder, valid PNG header bytes
  sampling_region: {
    shape: "rect" as const,
    half_w_px: 10,
    half_h_px: 10,
    center_px: [10, 10] as [number, number],
    fraction_label: "30%",
  },
  aggregator_results: {
    median: "#101010",
    mean: "#202020",
    saturation_median: "#303030",
    trimmed_mean: "#404040",
    kmeans_dominant: "#505050",
  },
};

function mockInspectFetch(resp: typeof fakeResponse | Error = fakeResponse) {
  vi.spyOn(globalThis, "fetch").mockImplementation(((url: string) => {
    if (String(url).includes("/inspect/")) {
      if (resp instanceof Error) return Promise.reject(resp);
      return Promise.resolve(
        new Response(JSON.stringify(resp), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.reject(new Error("unexpected " + url));
  }) as typeof fetch);
}

describe("InspectMatchDialog", () => {
  it("renders all 5 aggregator hex values after the inspect API resolves", async () => {
    mockInspectFetch();
    render(
      <InspectMatchDialog
        open={true}
        onOpenChange={() => {}}
        rid={1}
        row={0}
        col={0}
        currentAggregator="median"
        onAggregatorPicked={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("#101010")).toBeInTheDocument();
      expect(screen.getByText("#505050")).toBeInTheDocument();
    });
    // The active aggregator's name appears in the header "showing" line.
    expect(screen.getAllByText(/median/i).length).toBeGreaterThan(0);
  });

  it("calls onAggregatorPicked when a different tile is clicked", async () => {
    mockInspectFetch();
    const onPicked = vi.fn();
    render(
      <InspectMatchDialog
        open={true}
        onOpenChange={() => {}}
        rid={1}
        row={0}
        col={0}
        currentAggregator="median"
        onAggregatorPicked={onPicked}
      />,
    );
    const tile = await screen.findByLabelText(/Switch to Mean/i);
    fireEvent.click(tile);
    expect(onPicked).toHaveBeenCalledWith("mean");
  });

  it("renders an error message when the inspect API fails", async () => {
    mockInspectFetch(new Error("boom"));
    render(
      <InspectMatchDialog
        open={true}
        onOpenChange={() => {}}
        rid={1}
        row={0}
        col={0}
        currentAggregator="median"
        onAggregatorPicked={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Couldn't inspect this cell/i)).toBeInTheDocument();
    });
  });
});
