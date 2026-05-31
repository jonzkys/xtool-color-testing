// Extract base field-constraint ranges from one xTool Studio ext bundle.
// Usage: node parse-bundle.mjs /tmp/Contents/Resources/exts/<dir>/index.js
// Emits JSON: { field: {min, max, defMin, defMax, label} , ... } to stdout.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node parse-bundle.mjs <ext-bundle/index.js>");
  process.exit(2);
}
const js = readFileSync(file, "utf8");

// Field-definition objects: NAME:{label:`device.common.X`, ... min:N, max:M, ...}
const re = /(\w+):\{label:`(device\.common\.[^`]+)`[^{}]*?\}/g;
const out = {};
let m;
while ((m = re.exec(js))) {
  const block = m[0];
  const num = (k) => {
    const mm = block.match(new RegExp(k + ":(-?[0-9.]+(?:e[0-9]+)?)"));
    return mm ? Number(mm[1]) : null;
  };
  const key = m[1];
  const rec = {
    label: m[2].replace("device.common.", ""),
    min: num("min"),
    max: num("max"),
    defMin: num("defaultMinValue"),
    defMax: num("defaultMaxValue"),
  };
  // Keep the widest seen range for a repeated field name (union envelope).
  const prev = out[key];
  if (!prev) out[key] = rec;
  else {
    if (rec.min != null && (prev.min == null || rec.min < prev.min)) prev.min = rec.min;
    if (rec.max != null && (prev.max == null || rec.max > prev.max)) prev.max = rec.max;
  }
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
