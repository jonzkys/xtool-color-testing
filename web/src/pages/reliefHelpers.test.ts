import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_RELIEF_PARAMS,
  previewRatio,
  reliefSmooth,
  scaleParamsForPreview,
  sampleRgb,
} from "./reliefHelpers";

// jsdom doesn't ship the ImageData constructor. Shim a structural
// equivalent with the data-first signature used elsewhere in the repo.
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  (globalThis as unknown as { ImageData: typeof ImageData }).ImageData =
    ImageDataPolyfill as unknown as typeof ImageData;
}

describe("previewRatio", () => {
  it("is 1 when already within maxEdge", () => {
    expect(previewRatio(400, 300, 800)).toBe(1);
  });
  it("is maxEdge/longest when larger", () => {
    expect(previewRatio(1600, 400, 800)).toBeCloseTo(0.5, 5);
  });
});

describe("scaleParamsForPreview", () => {
  it("scales strength by the ratio (>=1), leaves thresholds alone", () => {
    const p = { ...DEFAULT_RELIEF_PARAMS, strength: 8, edgeThreshold: 40 };
    const out = scaleParamsForPreview(p, 0.5);
    expect(out.strength).toBe(4);
    expect(out.edgeThreshold).toBe(40);
  });
  it("never drops strength below 1", () => {
    expect(scaleParamsForPreview({ ...DEFAULT_RELIEF_PARAMS, strength: 1 }, 0.1).strength).toBe(1);
  });
});

describe("reliefSmooth form fields", () => {
  function stub() {
    const sent: FormData[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: { body: FormData }) => {
        sent.push(init.body);
        return Promise.resolve({ ok: true, blob: async () => new Blob() });
      });
    vi.stubGlobal("fetch", fetchMock);
    return sent;
  }

  it("always sends the smooth flag from params", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS, smoothEnabled: false });
    expect(sent[0].get("smooth")).toBe("false");
    vi.unstubAllGlobals();
  });

  it("omits clahe / bg fields when no opts given", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS });
    expect(sent[0].get("clahe")).toBeNull();
    expect(sent[0].get("remove_bg")).toBeNull();
    expect(sent[0].get("smooth")).toBe("true");
    vi.unstubAllGlobals();
  });

  it("appends clahe fields when opts.clahe given", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS }, {
      clahe: { clipLimit: 3, tiles: 8 },
    });
    expect(sent[0].get("clahe")).toBe("true");
    expect(sent[0].get("clahe_clip")).toBe("3");
    expect(sent[0].get("clahe_tiles")).toBe("8");
    vi.unstubAllGlobals();
  });

  it("appends background fields when opts.background given", async () => {
    const sent = stub();
    await reliefSmooth(new Blob(["x"]), { ...DEFAULT_RELIEF_PARAMS }, {
      background: {
        mode: "dark", threshold: 8, color: null, tolerance: 40,
        perimeterPct: 0, trimPct: 0, falloffPct: 0, falloffMode: "inward",
        falloffTarget: 0, falloffIntensity: 50,
      },
    });
    expect(sent[0].get("remove_bg")).toBe("true");
    expect(sent[0].get("bg_threshold")).toBe("8");
    expect(sent[0].get("bg_mode")).toBe("dark");
    vi.unstubAllGlobals();
  });
});

describe("sampleRgb", () => {
  it("reads the RGB at a fractional position", () => {
    // 2×1 image: left red, right blue.
    const data = new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1);
    expect(sampleRgb(data, 0.0, 0.0)).toEqual([255, 0, 0]);
    expect(sampleRgb(data, 0.99, 0.0)).toEqual([0, 0, 255]);
  });
  it("clamps out-of-range fractions", () => {
    const data = new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
    expect(sampleRgb(data, -5, 9)).toEqual([1, 2, 3]);
  });
});

describe("reliefSmooth background fields", () => {
  it("posts bg mode/colour/trim/falloff form fields", async () => {
    let sent: FormData | null = null;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent = init.body as FormData;
      return { ok: true, blob: async () => new Blob() } as Response;
    }) as typeof fetch;
    try {
      await reliefSmooth(new Blob(), { ...DEFAULT_RELIEF_PARAMS, smoothEnabled: true }, {
        background: {
          mode: "colour", threshold: 8, color: [10, 20, 30], tolerance: 25,
          perimeterPct: 4, trimPct: 3, falloffPct: 7, falloffMode: "outward",
          falloffTarget: 100, falloffIntensity: 70,
        },
      });
    } finally {
      globalThis.fetch = orig;
    }
    expect(sent!.get("remove_bg")).toBe("true");
    expect(sent!.get("bg_mode")).toBe("colour");
    expect(sent!.get("bg_color")).toBe("10,20,30");
    expect(sent!.get("bg_tolerance")).toBe("25");
    expect(sent!.get("perimeter_pct")).toBe("4");
    expect(sent!.get("trim_pct")).toBe("3");
    expect(sent!.get("falloff_pct")).toBe("7");
    expect(sent!.get("falloff_mode")).toBe("outward");
    expect(sent!.get("falloff_target")).toBe("100");
    expect(sent!.get("falloff_intensity")).toBe("70");
  });
});
