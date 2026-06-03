import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_RELIEF_PARAMS,
  previewRatio,
  reliefSmooth,
  scaleParamsForPreview,
} from "./reliefHelpers";

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
      background: { threshold: 8, high: false },
    });
    expect(sent[0].get("remove_bg")).toBe("true");
    expect(sent[0].get("bg_threshold")).toBe("8");
    expect(sent[0].get("bg_high")).toBe("false");
    vi.unstubAllGlobals();
  });
});
