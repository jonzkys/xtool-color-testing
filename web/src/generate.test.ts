import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OUTPUT_FORMAT,
  outputFilename,
  pixelArtAndDownload,
  svgLayersAndDownload,
} from "./generate";
import type { PixelArtRequest, SvgLayersRequest } from "./types";

/* ── Pure ext-selection helper ─────────────────────────────────────── */

describe("outputFilename", () => {
  it("appends the chosen format as the extension", () => {
    expect(outputFilename("my-project", "xs")).toBe("my-project.xs");
    expect(outputFilename("my-project", "xcs")).toBe("my-project.xcs");
  });
  it("defaults to .xs everywhere via DEFAULT_OUTPUT_FORMAT", () => {
    expect(DEFAULT_OUTPUT_FORMAT).toBe("xs");
    expect(outputFilename("p", DEFAULT_OUTPUT_FORMAT)).toBe("p.xs");
  });
});

/* ── Download helpers: format in the body + matching filename ───────── */

/** Captured arguments from the last download click. */
interface CapturedDownload {
  endpoint: string;
  body: Record<string, unknown>;
  filename: string;
}

function installDownloadHarness(): { last: () => CapturedDownload } {
  let lastBody: Record<string, unknown> = {};
  let lastEndpoint = "";
  let lastFilename = "";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      lastEndpoint = url;
      lastBody = JSON.parse(String(init?.body ?? "{}"));
      return {
        ok: true,
        status: 200,
        url,
        blob: async () => new Blob(["x"]),
      } as unknown as Response;
    }),
  );

  // jsdom may or may not define these depending on version; assign
  // directly so we don't trip "Cannot redefine property" on a
  // non-configurable descriptor. Restored implicitly per-test since the
  // helper reinstalls them each run.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(
    () => "blob:mock",
  );
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();

  // Capture the <a download> the helper synthesises without navigating.
  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = origCreate(tag) as HTMLElement;
    if (tag === "a") {
      (el as HTMLAnchorElement).click = vi.fn(() => {
        lastFilename = (el as HTMLAnchorElement).download;
      });
    }
    return el;
  });

  return {
    last: () => ({ endpoint: lastEndpoint, body: lastBody, filename: lastFilename }),
  };
}

function svgLayersReq(overrides: Partial<SvgLayersRequest> = {}): SvgLayersRequest {
  return {
    name: "demo",
    svg_content: "<svg/>",
    width_mm: 100,
    height_mm: null,
    start_x: 0,
    start_y: 0,
    material_id: "mat-1",
    layers: [],
    subtract_overlaps: false,
    ...overrides,
  };
}

function pixelArtReq(overrides: Partial<PixelArtRequest> = {}): PixelArtRequest {
  return {
    name: "demo",
    material_id: "mat-1",
    width_mm: 100,
    height_mm: 100,
    start_x: 0,
    start_y: 0,
    cell_mm: 1,
    shapes: [],
    layers: [],
    ...overrides,
  };
}

describe("generator download helpers thread `format`", () => {
  let harness: ReturnType<typeof installDownloadHarness>;

  beforeEach(() => {
    harness = installDownloadHarness();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("svgLayersAndDownload defaults to xs (ZIP) when no format given", async () => {
    await svgLayersAndDownload(svgLayersReq());
    const { endpoint, body, filename } = harness.last();
    expect(endpoint).toBe("/api/svg-layers");
    expect(body.format).toBe("xs");
    expect(filename).toBe("demo.xs");
  });

  it("svgLayersAndDownload honours an explicit xcs format", async () => {
    await svgLayersAndDownload(svgLayersReq({ format: "xcs" }));
    const { body, filename } = harness.last();
    expect(body.format).toBe("xcs");
    expect(filename).toBe("demo.xcs");
  });

  it("pixelArtAndDownload sends format and names the file to match", async () => {
    await pixelArtAndDownload(pixelArtReq({ name: "px", format: "xs" }));
    const { endpoint, body, filename } = harness.last();
    expect(endpoint).toBe("/api/pixel-art");
    expect(body.format).toBe("xs");
    expect(filename).toBe("px.xs");

    await pixelArtAndDownload(pixelArtReq({ name: "px", format: "xcs" }));
    const after = harness.last();
    expect(after.body.format).toBe("xcs");
    expect(after.filename).toBe("px.xcs");
  });

  it("falls back to a default name when the request name is empty", async () => {
    await svgLayersAndDownload(svgLayersReq({ name: "" }));
    expect(harness.last().filename).toBe("svg-layers.xs");
  });
});
