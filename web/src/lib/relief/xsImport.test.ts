import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import { parseXsDepthMaps } from "./xsImport";

/** Build a tiny synthetic .xs (a few JSON members + fake PNG resources) so the
 *  parser is tested without shipping a multi-MB fixture. */
function makeXs(): Uint8Array {
  const json = (o: unknown) => strToU8(JSON.stringify(o));
  return zipSync({
    "project.json": json({ modules: { canvases: ["c1"] } }),
    "canvases/c1/displays-0.json": json({
      displays: [
        { id: "d1", type: "BITMAP", name: "Logo", resourcePath: "resources/aaa.png", width: 50, height: 40 },
        { id: "d2", type: "BITMAP", name: null, resourcePath: "resources/bbb.png", width: 30, height: 30 },
        { id: "d3", type: "PATH", name: "Outline" }, // a cut — ignored
        { id: "d4", type: "BITMAP", name: "Photo", resourcePath: "resources/ccc.png", width: 10, height: 10 }, // engrave — ignored
      ],
    }),
    "devices/device-x.json": json({
      processing: {
        c1: {
          modes: {
            RELIEF_PROCESS: {
              bindings: [
                { displayIds: ["d1"], baseProfileId: "p_relief" },
                { displayIds: ["d2"], baseProfileId: "p_intaglio" },
              ],
            },
            VECTOR_PROCESS: { bindings: [{ displayIds: ["d3"], baseProfileId: "p_cut" }] },
            BITMAP_PROCESS: { bindings: [{ displayIds: ["d4"], baseProfileId: "p_engrave" }] },
          },
        },
      },
    }),
    "profiles.json": json({
      profiles: {
        p_relief: { processingType: "RELIEF" },
        p_intaglio: { processingType: "INTAGLIO" },
        p_cut: { processingType: "VECTOR_CUTTING" },
        p_engrave: { processingType: "BITMAP_ENGRAVING" },
      },
    }),
    "resources/aaa.png": new Uint8Array([10, 20, 30]),
    "resources/bbb.png": new Uint8Array([40, 50, 60]),
    "resources/ccc.png": new Uint8Array([70, 80, 90]),
  });
}

describe("parseXsDepthMaps", () => {
  it("returns only the RELIEF / INTAGLIO bitmaps, with their raster bytes", () => {
    const jobs = parseXsDepthMaps(makeXs());
    expect(jobs).toHaveLength(2);

    expect(jobs[0]).toMatchObject({
      name: "Logo",
      processingType: "RELIEF",
      widthMm: 50,
      heightMm: 40,
    });
    expect(Array.from(jobs[0].pngBytes)).toEqual([10, 20, 30]);

    expect(jobs[1]).toMatchObject({
      name: "Depth map 2", // null name → generated
      processingType: "INTAGLIO",
      widthMm: 30,
      heightMm: 30,
    });
    expect(Array.from(jobs[1].pngBytes)).toEqual([40, 50, 60]);
  });

  it("ignores vector cuts and plain bitmap engraves", () => {
    const names = parseXsDepthMaps(makeXs()).map((j) => j.name);
    expect(names).not.toContain("Outline"); // PATH / VECTOR_CUTTING
    expect(names).not.toContain("Photo"); // BITMAP / BITMAP_ENGRAVING
  });

  it("skips a relief job whose resource is missing", () => {
    const json = (o: unknown) => strToU8(JSON.stringify(o));
    const xs = zipSync({
      "project.json": json({ modules: { canvases: ["c1"] } }),
      "canvases/c1/displays-0.json": json({
        displays: [{ id: "d1", type: "BITMAP", resourcePath: "resources/gone.png", width: 5, height: 5 }],
      }),
      "devices/device-x.json": json({
        processing: { c1: { modes: { RELIEF_PROCESS: { bindings: [{ displayIds: ["d1"], baseProfileId: "p" }] } } } },
      }),
      "profiles.json": json({ profiles: { p: { processingType: "RELIEF" } } }),
      // no resources/gone.png
    });
    expect(parseXsDepthMaps(xs)).toEqual([]);
  });

  it("throws on a buffer that is not a zip", () => {
    expect(() => parseXsDepthMaps(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});
