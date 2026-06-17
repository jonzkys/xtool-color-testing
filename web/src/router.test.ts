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
    expect(parseRoute("#/stability")).toEqual({ name: "stability" });
    expect(parseRoute("#/stability/42")).toEqual({ name: "stability", id: 42 });
  });
  test("Cut menu routes", () => {
    expect(parseRoute("#/spiral")).toEqual({ name: "spiral" });
    // Forge stays at #/forge so old links/bookmarks survive the split.
    expect(parseRoute("#/forge")).toEqual({ name: "forge" });
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
      { name: "stability" },
      { name: "stability", id: 7 },
      { name: "spiral" },
      { name: "forge" },
    ] as const) {
      expect(parseRoute(formatRoute(r))).toEqual(r);
    }
  });
});

describe("depthmaps standalone route", () => {
  it("parses #/depthmaps", () => {
    expect(parseRoute("#/depthmaps")).toEqual({ name: "depthmaps" });
  });
  it("round-trips", () => {
    expect(parseRoute(formatRoute({ name: "depthmaps" }))).toEqual({
      name: "depthmaps",
    });
    expect(formatRoute({ name: "depthmaps" })).toBe("#/depthmaps");
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

describe("demo route with optional next", () => {
  it("parses bare #/demo", () => {
    expect(parseRoute("#/demo")).toEqual({ name: "demo" });
  });
  it("parses #/demo?next=changelog", () => {
    expect(parseRoute("#/demo?next=changelog"))
      .toEqual({ name: "demo", next: "changelog" });
  });
  it("decodes the next param", () => {
    expect(parseRoute("#/demo?next=tests%2F42"))
      .toEqual({ name: "demo", next: "tests/42" });
  });
  it("formats demo without next", () => {
    expect(formatRoute({ name: "demo" })).toBe("#/demo");
  });
  it("formats demo with next, encoding the value", () => {
    expect(formatRoute({ name: "demo", next: "tests/42" }))
      .toBe("#/demo?next=tests%2F42");
  });
});
