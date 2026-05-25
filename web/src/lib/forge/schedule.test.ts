// web/src/lib/forge/schedule.test.ts
import { describe, it, expect } from "vitest";
import { orderSegmentsInterlaced } from "./schedule";

describe("orderSegmentsInterlaced", () => {
  it("processes non-adjacent segments first (stride 3)", () => {
    const order = orderSegmentsInterlaced(9, { stride: 3, reverse: false, stagger: false, pass: 0 });
    // first pass picks 0,3,6 then 1,4,7 then 2,5,8
    expect(order.slice(0, 3)).toEqual([0, 3, 6]);
    expect(order.length).toBe(9);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("reverses order on odd passes when reverse=true", () => {
    const even = orderSegmentsInterlaced(6, { stride: 2, reverse: true, stagger: false, pass: 0 });
    const odd = orderSegmentsInterlaced(6, { stride: 2, reverse: true, stagger: false, pass: 1 });
    expect(odd).toEqual([...even].reverse());
  });
  it("staggers the starting offset between passes when stagger=true", () => {
    const p0 = orderSegmentsInterlaced(6, { stride: 3, reverse: false, stagger: true, pass: 0 });
    const p1 = orderSegmentsInterlaced(6, { stride: 3, reverse: false, stagger: true, pass: 1 });
    expect(p0[0]).not.toBe(p1[0]); // different physical start
  });
  it("is a permutation regardless of options", () => {
    const order = orderSegmentsInterlaced(10, { stride: 4, reverse: true, stagger: true, pass: 3 });
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
