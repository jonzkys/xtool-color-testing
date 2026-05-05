/**
 * Sanitise a filename into a server-acceptable project name.
 *
 * The backend pattern is ``^[A-Za-z0-9._\- ]+$`` (see
 * ``schemas.SvgLayersRequest.name`` / ``ParamTest.name``). Photo-app
 * exports routinely include commas, colons, parentheses — and
 * dropping a filename like ``ChatGPT Image May 1, 2026, 06:42:33 PM``
 * straight into the ``name`` field 422s the upload. This helper
 * collapses every disallowed character into a single hyphen, then
 * trims leading/trailing whitespace + hyphens so the resulting
 * string is both legal and tidy.
 *
 * The pattern is duplicated across SvgLayersPage, LoomPage, and
 * PixelArtPage — each had its own slightly-different inline regex
 * before this helper existed. Centralising avoids drift.
 *
 * @param name  raw filename (with or without extension)
 * @param fallback  used when the input is empty / sanitises to empty
 * @returns sanitised name, ≤ 64 chars
 */
export function sanitiseProjectName(name: string, fallback = ""): string {
  const cleaned = name
    // Strip a single file-extension suffix.
    .replace(/\.[^./\\]+$/, "")
    // Replace runs of disallowed chars with a single hyphen.
    .replace(/[^A-Za-z0-9._\- ]+/g, "-")
    // Collapse runs of hyphens (the regex above can produce them
    // when adjacent disallowed chars get rewritten).
    .replace(/-{2,}/g, "-")
    // Trim leading/trailing whitespace + hyphens.
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .slice(0, 64);
  return cleaned || fallback;
}
