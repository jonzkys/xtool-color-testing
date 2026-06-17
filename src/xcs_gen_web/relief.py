"""Edge-aware smoothing of grayscale depth maps for relief engraving.

The xTool machine maps a grayscale image's 0..255 onto N engraving pass-levels
itself (depth = pass count). Our job is to clean the heightfield so it engraves
without pixel oscillation or over-sharp risers, while preserving legitimate
sharp drops. Pure numpy/cv2 — no HTTP.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

__all__ = [
    "ReliefSmoothParams",
    "smooth_heightfield",
    "apply_clahe",
    "background_alpha",
    "encode_png_la",
    "to_grayscale_u8",
    "encode_png",
    "parse_rgb",
    "colour_background_alpha",
    "trim_alpha",
    "smooth_perimeter",
    "edge_falloff",
    "falloff_curve",
    "threshold_background_mask",
    "colour_background_mask",
    "area_background_mask",
    "combine_backgrounds",
    "split_internal_holes",
]


@dataclass(frozen=True)
class ReliefSmoothParams:
    strength: int = 8           # bilateral sigmaSpace (spatial radius, px)
    edge_preserve: bool = True  # the guard rail
    edge_threshold: int = 40    # preserve intensity jumps above this (0..255)
    spike_removal: bool = True
    median_ksize: int = 3  # snapped to 3 or 5 in __post_init__

    def __post_init__(self) -> None:
        object.__setattr__(self, "median_ksize", 5 if self.median_ksize >= 5 else 3)


def to_grayscale_u8(img: np.ndarray) -> np.ndarray:
    """Coerce a decoded image (BGR, BGRA, or single-channel) to contiguous uint8 gray."""
    if img.ndim == 2:
        gray = img
    elif img.ndim == 3 and img.shape[2] == 1:
        gray = img[:, :, 0]
    elif img.ndim == 3 and img.shape[2] == 4:
        gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
    elif img.ndim == 3 and img.shape[2] == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        raise ValueError(f"unsupported image shape {img.shape}")
    return np.ascontiguousarray(gray, dtype=np.uint8)


def smooth_heightfield(gray: np.ndarray, p: ReliefSmoothParams) -> np.ndarray:
    """Edge-aware denoise of a single-channel uint8 heightfield."""
    if gray.ndim != 2:
        raise ValueError("smooth_heightfield expects a single-channel image")

    # 1. spike removal — kill single-pixel oscillation
    work = gray
    if p.spike_removal:
        work = cv2.medianBlur(work, p.median_ksize)

    # 2. edge-aware smooth — bilateral; sigmaColor IS the guard rail
    # d=0 → neighbourhood auto-derived from sigmaSpace (~2*strength+1 px); keep strength small (cost is O(d^2 * pixels)).
    smoothed = cv2.bilateralFilter(
        work, d=0,
        sigmaColor=max(1, int(p.edge_threshold)),
        sigmaSpace=max(1, int(p.strength)),
    )

    # 3. explicit guard-rail freeze — hard-preserve real sharp drops.
    #    Measured on the DE-SPIKED image so spikes (already gone) aren't refrozen;
    #    morphological gradient = local max-min range, in intensity units, so the
    #    threshold compares apples-to-apples with edge_threshold.
    if p.edge_preserve:
        kernel = np.ones((3, 3), np.uint8)
        local_range = cv2.morphologyEx(work, cv2.MORPH_GRADIENT, kernel)
        edge_mask = (local_range > int(p.edge_threshold)).astype(np.uint8)
        edge_mask = cv2.dilate(edge_mask, kernel, iterations=1)
        smoothed = np.where(edge_mask.astype(bool), work, smoothed)

    return np.ascontiguousarray(smoothed, dtype=np.uint8)


def apply_clahe(
    gray: np.ndarray,
    clip_limit: float,
    tiles: int,
    mask: np.ndarray | None = None,
) -> np.ndarray:
    """Contrast-limited adaptive histogram equalization of a uint8 heightfield.

    Tile-adaptive local-contrast equalization — not expressible as a single
    256-LUT, hence done here on the backend rather than client-side. Runs on
    the already-smoothed field (denoise-then-stretch).

    When ``mask`` is given (foreground = ``mask > 0``), the background is
    neutralised to the foreground mean BEFORE equalizing, so a large uniform
    background can't skew the adaptive tile histograms near the object edge —
    the stretch is then computed from the cut-out, not the whole frame
    (matching the client monotonic stretches, which histogram only the
    foreground). Background pixels are masked out downstream anyway."""
    if gray.ndim != 2:
        raise ValueError("apply_clahe expects a single-channel image")
    n = max(1, int(tiles))
    clahe = cv2.createCLAHE(
        clipLimit=max(0.1, float(clip_limit)),
        tileGridSize=(n, n),
    )
    src = gray
    if mask is not None:
        if mask.shape != gray.shape:
            raise ValueError("apply_clahe: mask and gray must have the same shape")
        fg = mask > 0
        if fg.any() and not fg.all():
            src = gray.copy()
            src[~fg] = int(round(float(gray[fg].mean())))
    return np.ascontiguousarray(clahe.apply(src), dtype=np.uint8)


def threshold_background_mask(gray: np.ndarray, threshold: int, high: bool = False) -> np.ndarray:
    """Boolean background mask (True = background) from a luminance cut.

    ``high=False``: background is the dark end (``gray <= threshold``); the
    common case. ``high=True``: the bright end (``gray >= threshold``)."""
    if gray.ndim != 2:
        raise ValueError("threshold_background_mask expects a single-channel image")
    t = max(0, min(255, int(threshold)))
    return (gray >= t) if high else (gray <= t)


def background_alpha(gray: np.ndarray, threshold: int, high: bool = False) -> np.ndarray:
    """Alpha mask (uint8 0/255) marking background pixels transparent — the
    alpha form of ``threshold_background_mask``."""
    mask = threshold_background_mask(gray, threshold, high)
    return np.ascontiguousarray(np.where(mask, 0, 255).astype(np.uint8))


def parse_rgb(s: str) -> tuple[int, int, int] | None:
    """Parse ``'r,g,b'`` (each 0..255, clamped) → tuple, or None if malformed/empty."""
    parts = str(s).split(",")
    if len(parts) != 3:
        return None
    try:
        vals = [max(0, min(255, int(round(float(p))))) for p in parts]
    except ValueError:
        return None
    return (vals[0], vals[1], vals[2])


def _to_rgb(bgr: np.ndarray) -> np.ndarray:
    """Coerce BGR / BGRA / single-channel to an RGB array."""
    if bgr.ndim == 2:
        return cv2.cvtColor(bgr, cv2.COLOR_GRAY2RGB)
    if bgr.ndim == 3 and bgr.shape[2] == 4:
        return cv2.cvtColor(bgr, cv2.COLOR_BGRA2RGB)
    if bgr.ndim == 3 and bgr.shape[2] == 3:
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    raise ValueError(f"unsupported image shape {bgr.shape}")


def colour_background_mask(
    bgr: np.ndarray, color_rgb: tuple[int, int, int], tolerance: float
) -> np.ndarray:
    """Boolean background mask (True = background): pixels within Euclidean RGB
    distance ``tolerance`` of ``color_rgb``. Accepts BGR / BGRA / single-channel."""
    rgb = _to_rgb(bgr)
    target = np.array(color_rgb, dtype=np.float32).reshape(1, 1, 3)
    dist = np.sqrt(((rgb.astype(np.float32) - target) ** 2).sum(axis=2))
    return dist <= float(tolerance)


def area_background_mask(
    bgr: np.ndarray,
    color_rgb: tuple[int, int, int],
    tolerance: float,
    seed_xy: tuple[float, float] | None,
) -> np.ndarray:
    """Boolean background mask: the ``colour_background_mask`` for ``color_rgb``,
    restricted to the single connected component (8-connectivity) containing the
    seed pixel. ``seed_xy`` is a fractional (x, y) in [0, 1) — resolved the same
    way the frontend eyedropper samples colour, so it lands on the picked pixel
    at any resolution. Seed outside the colour range, or ``None`` → empty mask."""
    cand = colour_background_mask(bgr, color_rgb, tolerance)
    if seed_xy is None:
        return np.zeros(cand.shape, dtype=bool)
    h, w = cand.shape
    fx = min(0.999999, max(0.0, float(seed_xy[0])))
    fy = min(0.999999, max(0.0, float(seed_xy[1])))
    x = min(w - 1, int(fx * w))
    y = min(h - 1, int(fy * h))
    _num, labels = cv2.connectedComponents(cand.astype(np.uint8), connectivity=8)
    lbl = int(labels[y, x])
    if lbl == 0:
        return np.zeros(cand.shape, dtype=bool)
    return labels == lbl


def colour_background_alpha(
    bgr: np.ndarray, color_rgb: tuple[int, int, int], tolerance: float
) -> np.ndarray:
    """Alpha form of ``colour_background_mask`` (uint8 0/255)."""
    mask = colour_background_mask(bgr, color_rgb, tolerance)
    return np.ascontiguousarray(np.where(mask, 0, 255).astype(np.uint8))


def trim_alpha(alpha: np.ndarray, pct: float) -> np.ndarray:
    """Erode the foreground (``alpha > 0``) inward by ``pct``% of the object's
    shorter bbox side, shaving a fuzzy border. ``pct`` is relative to the WHOLE
    foreground bounding box (the union of all opaque regions). No-op for
    ``pct <= 0`` or a sub-pixel radius; clamps (returns the input) if the erosion
    would empty the object — never erase it."""
    if alpha.ndim != 2:
        raise ValueError("trim_alpha expects a single-channel alpha")
    if pct <= 0:
        return alpha
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return alpha
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    radius = int(round(pct / 100.0 * short))
    if radius < 1:
        return alpha
    k = 2 * radius + 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    eroded = cv2.erode(fg, kernel, iterations=1)
    if not eroded.any():
        return alpha  # clamp: never erase the whole object
    return np.ascontiguousarray(np.where(eroded > 0, 255, 0).astype(np.uint8))


def smooth_perimeter(
    gray: np.ndarray, alpha: np.ndarray, pct: float
) -> tuple[np.ndarray, np.ndarray]:
    """Round off the silhouette boundary itself so the engraved wall (and any edge
    taper) follows a clean curve instead of the source mask's pixel staircase.

    A threshold/chroma-keyed outline is jagged at the pixel level — that staircase
    becomes the residual teeth on a tapered rim. Two passes: (1) blur the binary
    mask and re-threshold to round the boundary SHAPE symmetrically (better than
    morphology for organic outlines) — notches and matching protrusions within
    ``pct``% of the object's shorter bbox side wash out; pixels the smoothing ADDS
    take the nearest edge height so no holes appear. (2) Even out the rim HEIGHT in
    a band around the new boundary with a normalised blur (background never bleeds
    the rim down), leaving the interior sharp. Returns ``(gray, alpha)``; no-op for
    ``pct <= 0``, an empty mask, or a sub-pixel radius. Clamps (returns inputs) if
    it would empty the object."""
    if gray.ndim != 2 or alpha.ndim != 2:
        raise ValueError("smooth_perimeter expects single-channel gray + alpha")
    if gray.shape != alpha.shape:
        raise ValueError("smooth_perimeter: gray and alpha must have the same shape")
    if pct <= 0:
        return gray, alpha
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return gray, alpha
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    radius = int(round(pct / 100.0 * short))
    if radius < 1:
        return gray, alpha
    # Blur the mask and re-threshold at 50% → a boundary that ignores features
    # smaller than ~radius. sigma ≈ radius gives that cut-off.
    blurred = cv2.GaussianBlur(fg.astype(np.float32) * 255.0, (0, 0), float(radius))
    clean = (blurred >= 127.5).astype(np.uint8)
    if not clean.any():
        return gray, alpha  # clamp: never erase the whole object
    new_alpha = np.where(clean > 0, 255, 0).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    out = gray.astype(np.float32)
    # Give pixels the smoothing ADDED (former background, now opaque) a height
    # pulled from the nearest original foreground — a dilation of the masked gray
    # reaches them since they sit within ~radius of the old boundary.
    added = (clean > 0) & (fg == 0)
    if added.any():
        edge_fill = cv2.dilate(np.where(fg > 0, gray, 0), k, iterations=1).astype(np.float32)
        out = np.where(added, edge_fill, out)
    # Even out the rim height in a band just inside the new boundary. A normalised
    # (mask-weighted) blur means the floor/background never drags the rim down; the
    # interior — outside the band — is left untouched so detail stays crisp.
    new_fg = clean.astype(np.float32)
    band_mask = (clean > 0) & (cv2.erode(clean, k, iterations=1) == 0)
    if band_mask.any():
        ksm = max(3, radius | 1)
        num = cv2.GaussianBlur(out * new_fg, (ksm, ksm), 0)
        den = cv2.GaussianBlur(new_fg, (ksm, ksm), 0)
        out = np.where(band_mask, num / np.maximum(den, 1e-6), out)
    out = np.clip(np.rint(out), 0, 255).astype(np.uint8)
    return np.ascontiguousarray(out), np.ascontiguousarray(new_alpha)


def falloff_curve(t: np.ndarray, intensity: float) -> np.ndarray:
    """Ease ``t``∈[0,1] → [0,1] with a steepness set by ``intensity`` (0..100):
    0 = gentle (linear), 50 = smoothstep, 100 = sharp (smootherstep). Continuous,
    monotonic, and pinned at the ends (c(0)=0, c(1)=1) for every intensity."""
    tc = np.clip(t, 0.0, 1.0)
    lin = tc
    smooth = tc * tc * (3.0 - 2.0 * tc)
    smoother = tc * tc * tc * (tc * (6.0 * tc - 15.0) + 10.0)
    k = max(0.0, min(100.0, float(intensity)))
    if k <= 50.0:
        f = k / 50.0
        return lin * (1.0 - f) + smooth * f
    f = (k - 50.0) / 50.0
    return smooth * (1.0 - f) + smoother * f


def _smooth_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    """Round off segmentation jaggies before a distance-based ramp.

    A threshold/chroma-key boundary is pixel-noisy: tiny background notches poke
    into the object. A distance transform keeps those notch pixels "near the
    edge", so a ramp toward a high target spikes along them — the sawtooth comb.
    Closing fills the notches (kills inward fingers); opening shaves matching
    protrusions. Returns a uint8 0/1 mask; the kernel scales with the band so a
    wide falloff cleans proportionally more."""
    r = max(1, radius // 2)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    m = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    return (m > 0).astype(np.uint8)


# Grey level by which an outward berm becomes fully opaque; below it the berm's
# alpha fades to 0 so its near-floor outer fringe blends into the (transparent)
# background instead of showing as an opaque near-black ring.
FLOOR_FADE = 24.0


def edge_falloff(
    gray: np.ndarray,
    alpha: np.ndarray,
    pct: float,
    mode: str = "inward",
    target: float = 0.0,
    intensity: float = 50.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Soften the object edge over a band of ``pct``% of the object's shorter bbox
    side, eased by ``intensity`` (see ``falloff_curve``). Returns ``(gray, alpha)``.

    - ``mode="inward"``: ramp the existing pixels in a band INSIDE the boundary
      toward the target; the object footprint (alpha) is unchanged.
    - ``mode="outward"``: GROW the object by the band (dilate the OUTER silhouette)
      and lay a BERM in the added ring — rising from the floor at the outer edge up
      to the crest (``target``) at the band midline, then down to the object rim
      height. No vertical outer cliff, so the border stays smooth around intricate
      silhouettes. The object's own surface is untouched; the alpha grows to include
      the berm.

    ``target`` is the grey LEVEL the edge eases toward, 0..255 (0 = floor, 255 =
    peak — any level in between). No-op (returns inputs) for ``pct <= 0``, an empty
    mask, or a sub-pixel band."""
    if gray.ndim != 2 or alpha.ndim != 2:
        raise ValueError("edge_falloff expects single-channel gray + alpha")
    if gray.shape != alpha.shape:
        raise ValueError("edge_falloff: gray and alpha must have the same shape")
    if pct <= 0:
        return gray, alpha
    fg = (alpha > 0).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    if ys.size == 0:
        return gray, alpha
    short = min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1))
    band = pct / 100.0 * short
    if band < 1:
        return gray, alpha
    tgt = max(0.0, min(255.0, float(target)))
    g = gray.astype(np.float32)
    radius = int(round(band))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))

    if str(mode) == "outward":
        # Grow the OUTER silhouette only: fill internal holes first so the berm
        # doesn't rise in every internal gap of complex art (the source of the
        # spiky "forest" on detailed depth maps).
        contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        filled = np.zeros_like(fg)
        cv2.drawContours(filled, contours, -1, 1, thickness=cv2.FILLED)
        dilated = cv2.dilate(filled, kernel, iterations=1)
        ring = (dilated > 0) & (filled == 0)
        # Object rim height, spread outward to seed the ring's INNER edge.
        eroded = cv2.erode(filled, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)
        boundary_gray = np.where((filled > 0) & (eroded == 0), gray, 0).astype(np.uint8)
        base = cv2.dilate(boundary_gray, kernel, iterations=1).astype(np.float32)
        # BERM profile: rise from the FLOOR at the outer edge up to the crest
        # (target) at the band midline, then down to the object rim height at the
        # inner edge — a rounded ridge with NO vertical outer cliff. A raised wall
        # (target held to the very outer edge) becomes a thin vertical face that
        # goes spiky around intricate silhouettes; sloping both sides keeps the
        # border smooth on any shape. distance is measured inward from the outer
        # edge so the crest sits at a consistent depth all the way round.
        t_out = np.clip(
            cv2.distanceTransform(dilated, cv2.DIST_L2, cv2.DIST_MASK_PRECISE) / band,
            0.0, 1.0,
        )  # 0 at the outer edge → 1 at the object boundary
        u_out = falloff_curve(np.clip(t_out / 0.5, 0.0, 1.0), intensity)        # floor → crest
        u_in = falloff_curve(np.clip((t_out - 0.5) / 0.5, 0.0, 1.0), intensity)  # crest → object
        ring_h = np.where(
            t_out <= 0.5,
            tgt * u_out,                       # outer slope: 0 (floor) → target
            tgt * (1.0 - u_in) + base * u_in,  # inner slope: target → object rim
        )
        out = np.where(ring, ring_h, g)
        # No blur here: the precise distance field gives a smooth radial profile
        # and (when enabled) smooth_perimeter has already cleaned the boundary
        # tangentially. Blurring would bleed the crest outward and lift the outer
        # edge off the floor — reintroducing the very cliff the berm avoids.
        #
        # Alpha: the object stays fully opaque, but the berm RING fades to
        # transparent as its height nears the floor. Otherwise the outer slope's
        # gray-0 fringe is an opaque near-black ring against the transparent
        # background. Fading the alpha (rather than holding it opaque) blends the
        # fringe into the backdrop while the surface still reaches the floor
        # before going transparent — so there's no 3D cliff and no black band.
        ring_alpha = np.clip(ring_h / FLOOR_FADE, 0.0, 1.0) * 255.0
        out_alpha = np.where(fg > 0, 255.0, np.where(ring, ring_alpha, 0.0))
        return (
            np.ascontiguousarray(np.clip(np.rint(out), 0, 255).astype(np.uint8)),
            np.ascontiguousarray(np.clip(np.rint(out_alpha), 0, 255).astype(np.uint8)),
        )

    # inward — ramp a band INSIDE the boundary from the target (at the edge) back
    # to the original surface. The comb on a noisy silhouette is a TANGENTIAL
    # variation (along the boundary): cleaning the mask removes it at the source,
    # so the ramp stays smooth without blurring the radial profile (which would
    # pull the edge off its target). A precise distance field avoids stair-steps.
    clean = _smooth_mask(fg, radius)
    dist = cv2.distanceTransform(clean, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    c = falloff_curve(dist / band, intensity)  # 0 at boundary → 1 at inner edge
    blended = tgt + (g - tgt) * c
    out = np.where(fg > 0, np.rint(blended), g)
    return np.ascontiguousarray(np.clip(out, 0, 255).astype(np.uint8)), alpha


def combine_backgrounds(
    masks: list[np.ndarray], shape: tuple[int, int] | None = None
) -> np.ndarray:
    """OR a list of boolean background masks (True = background) into an alpha
    (uint8 0/255: 0 = background/transparent, 255 = foreground). An empty list
    returns all-foreground (255) when ``shape`` is given; raises ``ValueError``
    without it."""
    if masks:
        bg = np.zeros(masks[0].shape, dtype=bool)
        for m in masks:
            if m.shape != bg.shape:
                raise ValueError("combine_backgrounds: masks must share a shape")
            bg |= m.astype(bool)
    elif shape is not None:
        bg = np.zeros(shape, dtype=bool)
    else:
        raise ValueError("combine_backgrounds: empty masks needs an explicit shape")
    return np.ascontiguousarray(np.where(bg, 0, 255).astype(np.uint8))


def encode_png_la(gray: np.ndarray, alpha: np.ndarray) -> bytes:
    """Encode grayscale + alpha as an ``LA`` PNG (transparent background)."""
    lum = Image.fromarray(np.ascontiguousarray(gray, dtype=np.uint8), mode="L")
    a = Image.fromarray(np.ascontiguousarray(alpha, dtype=np.uint8), mode="L")
    buf = BytesIO()
    Image.merge("LA", [lum, a]).save(buf, format="PNG")
    return buf.getvalue()


def encode_png(gray: np.ndarray) -> bytes:
    """Encode a single-channel uint8 array to PNG bytes (mode L)."""
    buf = BytesIO()
    Image.fromarray(gray, mode="L").save(buf, format="PNG")
    return buf.getvalue()


def split_internal_holes(alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Split a 0/255 alpha into ``(solid_alpha, holes)``.

    A "hole" is a background pixel (alpha == 0) not connected to the image
    border — an enclosed pocket. ``holes`` is a boolean mask of those pixels;
    ``solid_alpha`` is ``alpha`` with the holes filled to 255 (opaque), i.e. the
    outer silhouette only. Border-connected background is left as background."""
    if alpha.ndim != 2:
        raise ValueError("split_internal_holes expects a single-channel alpha")
    bg = (alpha == 0).astype(np.uint8)             # 1 = background
    # Flood the OUTER background inward from a 1px background border so a corner
    # that happens to be foreground can't trap the fill. Foreground (0) walls it.
    bordered = cv2.copyMakeBorder(bg, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=1)
    ffmask = np.zeros((bordered.shape[0] + 2, bordered.shape[1] + 2), np.uint8)
    cv2.floodFill(bordered, ffmask, (0, 0), 2)     # outer background → 2
    outer = bordered[1:-1, 1:-1] == 2
    holes = (alpha == 0) & (~outer)
    solid = alpha.copy()
    solid[holes] = 255
    return np.ascontiguousarray(solid), np.ascontiguousarray(holes)
