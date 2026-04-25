import { describe, expect, it } from "vitest";
import { computePager } from "./favoritesPager";

describe("computePager", () => {
  it("computes page size from container width", () => {
    expect(computePager({ totalCount: 12, containerWidth: 400, chipWidth: 80, page: 0 }).pageSize).toBe(5);
    expect(computePager({ totalCount: 12, containerWidth: 200, chipWidth: 80, page: 0 }).pageSize).toBe(2);
  });

  it("ensures pageSize is at least 1 even on tiny containers", () => {
    expect(computePager({ totalCount: 5, containerWidth: 30, chipWidth: 80, page: 0 }).pageSize).toBe(1);
  });

  it("returns the slice for the current page", () => {
    const r = computePager({ totalCount: 12, containerWidth: 400, chipWidth: 80, page: 1 });
    expect(r.pageSize).toBe(5);
    expect(r.start).toBe(5);
    expect(r.end).toBe(10);
    expect(r.totalPages).toBe(3);
  });

  it("clamps page upward when shrinking past the end", () => {
    const r = computePager({ totalCount: 12, containerWidth: 400, chipWidth: 80, page: 9 });
    expect(r.page).toBe(2);
    expect(r.start).toBe(10);
    expect(r.end).toBe(12);
  });

  it("handles empty inputs without dividing by zero", () => {
    const r = computePager({ totalCount: 0, containerWidth: 400, chipWidth: 80, page: 0 });
    expect(r.pageSize).toBe(5);
    expect(r.totalPages).toBe(0);
    expect(r.start).toBe(0);
    expect(r.end).toBe(0);
  });
});
