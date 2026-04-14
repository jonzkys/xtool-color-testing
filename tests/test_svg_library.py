"""Sanity checks on the svgelements library so we understand its behaviour
before building on top of it."""

from svgelements import SVG, Path, Rect, Circle


INLINE_SVG = """<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <g transform="translate(10, 20)">
    <rect x="0" y="0" width="30" height="40" fill="#ff0000" />
    <circle cx="50" cy="50" r="10" fill="#00ff00" stroke="#0000ff" stroke-width="2" />
    <path d="M 0,0 L 50,50 Z" fill="#ffd73e" />
  </g>
</svg>
"""


def test_svgelements_parses_inline():
    svg = SVG.parse(source=_as_file(INLINE_SVG))
    elements = list(svg.elements())
    # At least the SVG root, the <g>, and three shapes.
    assert any(isinstance(e, Rect) for e in elements)
    assert any(isinstance(e, Circle) for e in elements)
    assert any(isinstance(e, Path) for e in elements)


def test_svgelements_bakes_transforms():
    svg = SVG.parse(source=_as_file(INLINE_SVG))
    for el in svg.elements():
        if isinstance(el, Rect):
            # The rect was translated by (10, 20). svgelements exposes an
            # absolute transform via el.transform — the bbox should reflect it.
            bbox = el.bbox()
            assert bbox is not None
            x0, y0, x1, y1 = bbox
            assert abs(x0 - 10) < 0.01
            assert abs(y0 - 20) < 0.01
            assert abs(x1 - 40) < 0.01  # 10 + 30
            assert abs(y1 - 60) < 0.01  # 20 + 40
            return
    raise AssertionError("No rect found")


def test_svgelements_resolves_style():
    svg = SVG.parse(source=_as_file(INLINE_SVG))
    for el in svg.elements():
        if isinstance(el, Rect):
            assert str(el.fill).lower() in ("#ff0000", "red")
            return
    raise AssertionError("No rect found")


def _as_file(content: str):
    import io
    return io.StringIO(content)
