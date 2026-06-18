import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

// Timer advances are wrapped in act() so the resulting setState flushes.
describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue(1, 400));
    expect(result.current).toBe(1);
  });

  it("updates only after the delay elapses with no further change", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 400), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    expect(result.current).toBe(1); // not yet
    act(() => { vi.advanceTimersByTime(399); });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(2);
  });

  it("coalesces a rapid burst into a single trailing update", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 400), {
      initialProps: { v: 0 },
    });
    for (const v of [1, 2, 3, 4, 5]) {
      rerender({ v });
      act(() => { vi.advanceTimersByTime(100); }); // each change resets the 400ms timer
    }
    expect(result.current).toBe(0); // nothing settled during the burst
    act(() => { vi.advanceTimersByTime(400); });
    expect(result.current).toBe(5); // only the last value lands
  });
});
