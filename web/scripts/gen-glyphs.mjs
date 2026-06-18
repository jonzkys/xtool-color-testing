// One-off: bake JetBrains Mono glyph outlines into src/lib/forge/glyphTable.json.
// JetBrains Mono is OFL (already bundled via @fontsource); we embed an outline
// subset for engraved labels. Run: node scripts/gen-glyphs.mjs <path-to-JetBrainsMono-Regular.ttf>
import opentype from "opentype.js";
import { readFileSync, writeFileSync } from "node:fs";

const ttfPath = process.argv[2];
if (!ttfPath) throw new Error("usage: node gen-glyphs.mjs <JetBrainsMono-Regular.ttf>");
const buf = readFileSync(ttfPath);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const upm = font.unitsPerEm;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ./-()%:".split("");

const nx = (v) => +(v / upm).toFixed(4);
// getPath already returns y-DOWN screen coords (baseline at the passed y,
// ascenders negative) — exactly our mm convention. Do NOT negate, or glyphs
// render upside-down.
const ny = (v) => +(v / upm).toFixed(4);
const glyphs = {};
for (const ch of CHARS) {
  const g = font.charToGlyph(ch);
  const adv = +(((g.advanceWidth ?? upm) / upm)).toFixed(4);
  const path = g.getPath(0, 0, upm); // baseline at y=0, font units, y-down screen coords
  const d = path.commands
    .map((c) => {
      switch (c.type) {
        case "M": return `M${nx(c.x)},${ny(c.y)}`;
        case "L": return `L${nx(c.x)},${ny(c.y)}`;
        case "Q": return `Q${nx(c.x1)},${ny(c.y1)} ${nx(c.x)},${ny(c.y)}`;
        case "C": return `C${nx(c.x1)},${ny(c.y1)} ${nx(c.x2)},${ny(c.y2)} ${nx(c.x)},${ny(c.y)}`;
        case "Z": return "Z";
        default: return "";
      }
    })
    .join(" ");
  glyphs[ch] = { d, adv };
}
const out = { unitsPerEm: 1, ascent: +(font.ascender / upm).toFixed(4), glyphs };
writeFileSync(new URL("../src/lib/forge/glyphTable.json", import.meta.url), JSON.stringify(out));
console.log(`baked ${CHARS.length} glyphs → src/lib/forge/glyphTable.json`);
