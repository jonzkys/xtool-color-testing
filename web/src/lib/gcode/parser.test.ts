import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGcode } from "./parser";

describe("parseGcode", () => {
  it("returns an empty file for an empty input", () => {
    const result = parseGcode("");
    expect(result.jobs).toEqual([]);
    expect(result.canvas).toEqual({ w: 0, h: 0 });
    expect(result.offset).toEqual({ x: 0, y: 0 });
    expect(result.totalLines).toBe(0);
    expect(result.unknownLineCount).toBe(0);
  });

  it("parses the canvas size and offset from # gc= header lines", () => {
    const text = [
      "# date=2026_05_18_12_46_40",
      "# version=1.6.8",
      `# gc={"size":{"w":220,"h":220}}`,
      `# gc={"offset":{"x":1,"y":2}}`,
      `# gc={"start":{"x":0,"y":0.0000}}`,
      `# gc={"keys":["x","y"],"rm":1,"is3DMode":false}`,
    ].join("\n");
    const result = parseGcode(text);
    expect(result.canvas).toEqual({ w: 220, h: 220 });
    expect(result.offset).toEqual({ x: 1, y: 2 });
  });

  it("identifies one job with two blocks that have no blockConfig (→ no layers)", () => {
    const text = [
      "# GS004-4 HEAD",
      "# GS004-4 BITMAP HEAD",
      "# motion_start",
      "# motion_end",
      "# GS004-4 BITMAP TAIL",
      "# GS004-4 VECTOR HEAD",
      "# motion_start",
      "# motion_end",
      "# GS004-4 VECTOR TAIL",
      "# GS004-4 TAIL",
      "# END",
    ].join("\n");
    const result = parseGcode(text);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].name).toBe("GS004-4");
    expect(result.jobs[0].layers).toHaveLength(0);
  });

  it("extracts G0/G1 segments with modal X/Y/S; computes bbox; groups into one layer", () => {
    const text = [
      "# GS004-4 HEAD",
      "# GS004-4 BITMAP HEAD",
      "# motion_start",
      `# blockConfig={"powerFactor":0.9,"power":[0,900],"isVector":false}`,
      "G1F90000S0",
      "G0X10Y20",
      "G1X15S900",
      "G1Y25",
      "G1X12S0",
      "# motion_end",
      "# GS004-4 BITMAP TAIL",
      "# GS004-4 TAIL",
    ].join("\n");
    const result = parseGcode(text);
    expect(result.jobs).toHaveLength(1);
    const job = result.jobs[0];
    expect(job.layers).toHaveLength(1);
    const layer = job.layers[0];
    expect(layer.blocks).toHaveLength(1);
    const block = layer.blocks[0];
    expect(block.segments).toEqual([
      { x: 10, y: 20, s: 0,   rapid: true  },
      { x: 15, y: 20, s: 900, rapid: false },
      { x: 15, y: 25, s: 900, rapid: false },
      { x: 12, y: 25, s: 0,   rapid: false },
    ]);
    expect(block.bbox).toEqual({ minX: 10, minY: 20, maxX: 15, maxY: 25 });
    expect(layer.totalSegments).toBe(4);
    expect(job.bbox).toEqual({ minX: 10, minY: 20, maxX: 15, maxY: 25 });
  });

  it("groups consecutive same-config blocks but splits across config changes", () => {
    const cfgA = `{"powerFactor":0.9,"power":[0,900],"isVector":false}`;
    const cfgB = `{"powerFactor":1,"power":[0,1000],"isVector":false}`;
    const makeBlock = (cfg: string, x: number) => [
      "# GS004-4 BITMAP HEAD",
      "# motion_start",
      `# blockConfig=${cfg}`,
      `G0X${x}Y0`,
      `G1X${x + 1}S900`,
      "# motion_end",
      "# GS004-4 BITMAP TAIL",
    ].join("\n");

    const text = [
      "# GS004-4 HEAD",
      makeBlock(cfgA, 0),
      makeBlock(cfgA, 5),
      makeBlock(cfgB, 10),
      makeBlock(cfgA, 15),
      "# GS004-4 TAIL",
    ].join("\n");

    const result = parseGcode(text);
    expect(result.jobs).toHaveLength(1);
    const layers = result.jobs[0].layers;
    expect(layers.map(l => l.config.raw)).toEqual([cfgA, cfgB, cfgA]);
    expect(layers.map(l => l.blocks.length)).toEqual([2, 1, 1]);
    expect(layers.map(l => l.index)).toEqual([0, 1, 2]);
  });

  it("parses the real sampleEng.gc end-to-end", () => {
    const path = resolve(__dirname, "../../../../samples/xcode/sampleEng.gc");
    const text = readFileSync(path, "utf-8");
    const result = parseGcode(text);

    expect(result.canvas).toEqual({ w: 220, h: 220 });
    expect(result.offset).toEqual({ x: 0, y: 0 });
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.name).toBe("GS004-4");
    expect(job.layers.length).toBeGreaterThanOrEqual(4);

    for (let i = 1; i < job.layers.length; i++) {
      expect(job.layers[i].config.raw).not.toBe(job.layers[i - 1].config.raw);
    }

    const totalBlocks = job.layers.reduce((n, l) => n + l.blocks.length, 0);
    const blockConfigLines = text
      .split("\n")
      .filter(l => l.startsWith("# blockConfig=")).length;
    expect(totalBlocks).toBe(blockConfigLines);

    const vectorLayer = job.layers.find(l => {
      const p = l.config.parsed as { isVector?: boolean } | null;
      return p?.isVector === true;
    });
    expect(vectorLayer).toBeDefined();
    expect(vectorLayer!.blocks).toHaveLength(1);
    const burnSegs = vectorLayer!.blocks[0].segments.filter(s => !s.rapid && s.s > 0);
    expect(burnSegs).toHaveLength(1);
    expect(burnSegs[0].x).toBeCloseTo(117.040, 3);
    expect(burnSegs[0].y).toBeCloseTo(106.439, 3);

    expect(job.bbox.minX).toBeGreaterThanOrEqual(0);
    expect(job.bbox.minY).toBeGreaterThanOrEqual(0);
    expect(job.bbox.maxX).toBeLessThanOrEqual(220);
    expect(job.bbox.maxY).toBeLessThanOrEqual(220);
  }, 30_000);
});
