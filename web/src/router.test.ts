// @vitest-environment jsdom
import { describe, expect, test, it, beforeEach } from "vitest";
import { parseRoute, formatRoute } from "./router";

beforeEach(() => { window.location.hash = ""; });

describe("parseRoute", () => {
  test("defaults to tests list", () => {
    expect(parseRoute("")).toEqual({ name: "tests" });
    expect(parseRoute("#/")).toEqual({ name: "tests" });
  });
  test("tests detail", () => {
    expect(parseRoute("#/tests/42")).toEqual({ name: "test-detail", id: 42 });
    expect(parseRoute("#/tests/new")).toEqual({ name: "test-new" });
  });
  test("top-level tabs", () => {
    expect(parseRoute("#/loom")).toEqual({ name: "loom" });
    expect(parseRoute("#/svg-stack")).toEqual({ name: "loom" }); // legacy alias
    expect(parseRoute("#/svg-layers")).toEqual({ name: "svg-layers" });
    expect(parseRoute("#/library")).toEqual({ name: "library" });
    expect(parseRoute("#/palette")).toEqual({ name: "palette" });
  });
});

describe("formatRoute", () => {
  test("round-trip", () => {
    for (const r of [
      { name: "tests" },
      { name: "test-new" },
      { name: "test-detail", id: 7 },
      { name: "loom" },
      { name: "library" },
      { name: "palette" },
    ] as const) {
      expect(parseRoute(formatRoute(r))).toEqual(r);
    }
  });
});

describe("mobile-upload route", () => {
  it("parses #/m/<mid>", () => {
    expect(parseRoute("#/m/abc_def_123")).toEqual({
      name: "mobile-upload", mid: "abc_def_123",
    });
  });
  it("formats mobile-upload to #/m/<mid>", () => {
    expect(formatRoute({ name: "mobile-upload", mid: "xyz" }))
      .toBe("#/m/xyz");
  });
});
