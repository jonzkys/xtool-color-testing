"""Tests for grayscale depth-map smoothing (relief)."""
from __future__ import annotations

from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from xcs_gen_web.relief import (
    ReliefSmoothParams,
    smooth_heightfield,
    to_grayscale_u8,
    encode_png,
)


def test_smooth_removes_single_pixel_spike():
    gray = np.full((20, 20), 100, dtype=np.uint8)
    gray[10, 10] = 255  # one bright spike
    out = smooth_heightfield(gray, ReliefSmoothParams())
    assert abs(int(out[10, 10]) - 100) < 20
    assert out.dtype == np.uint8
    assert out.shape == gray.shape


def test_smooth_preserves_a_real_step_edge():
    gray = np.empty((20, 20), dtype=np.uint8)
    gray[:, :10] = 50
    gray[:, 10:] = 200  # a 150-level jump, well above edge_threshold=40
    out = smooth_heightfield(gray, ReliefSmoothParams())
    assert out[:, 8].mean() < 90
    assert out[:, 11].mean() > 160


def test_smooth_keeps_a_monotonic_ramp_monotonic():
    row = np.linspace(0, 255, 256).astype(np.uint8)
    gray = np.tile(row, (32, 1))  # 32×256 horizontal ramp
    out = smooth_heightfield(gray, ReliefSmoothParams())
    diffs = np.diff(out[16].astype(np.int16))
    assert diffs.min() >= -2  # no significant new reversals introduced


def test_encode_png_round_trips_grayscale():
    gray = np.full((8, 12), 128, dtype=np.uint8)
    img = Image.open(BytesIO(encode_png(gray)))
    assert img.mode == "L"
    assert img.size == (12, 8)  # PIL size is (w, h)


def test_to_grayscale_u8_handles_channel_layouts():
    gray2d = np.full((4, 4), 120, dtype=np.uint8)
    assert to_grayscale_u8(gray2d).shape == (4, 4)

    bgr = cv2.cvtColor(gray2d, cv2.COLOR_GRAY2BGR)
    out_bgr = to_grayscale_u8(bgr)
    assert out_bgr.ndim == 2 and out_bgr.dtype == np.uint8

    bgra = cv2.cvtColor(gray2d, cv2.COLOR_GRAY2BGRA)
    out_bgra = to_grayscale_u8(bgra)
    assert out_bgra.ndim == 2 and out_bgra.dtype == np.uint8


def test_apply_clahe_increases_local_contrast():
    from xcs_gen_web.relief import apply_clahe

    # A low-contrast gradient bunched in a narrow band.
    row = np.linspace(90, 150, 256).astype(np.uint8)
    gray = np.tile(row, (64, 1))
    out = apply_clahe(gray, clip_limit=2.0, tiles=8)
    assert out.dtype == np.uint8
    assert out.shape == gray.shape
    # CLAHE should widen the value range vs the cramped input.
    assert int(out.max()) - int(out.min()) >= int(gray.max()) - int(gray.min())


def test_apply_clahe_handles_flat_field_without_error():
    from xcs_gen_web.relief import apply_clahe

    gray = np.full((32, 32), 128, dtype=np.uint8)
    out = apply_clahe(gray, clip_limit=2.0, tiles=8)
    assert out.shape == (32, 32)
    assert out.dtype == np.uint8


def test_apply_clahe_mask_equalizes_only_the_foreground():
    from xcs_gen_web.relief import apply_clahe

    # A small mid-tone, faintly-textured object on a large flat-dark background.
    rng = np.random.default_rng(0)
    gray = np.zeros((80, 80), np.uint8)
    fg = (slice(25, 55), slice(25, 55))  # misaligned with the 10px tile grid
    gray[fg] = np.clip(120 + rng.integers(-8, 8, (30, 30)), 0, 255)
    mask = np.zeros((80, 80), np.uint8)
    mask[fg] = 255

    plain = apply_clahe(gray, clip_limit=4.0, tiles=8)
    masked = apply_clahe(gray, clip_limit=4.0, tiles=8, mask=mask)
    assert masked.shape == gray.shape and masked.dtype == np.uint8
    # Excluding the dark background from the adaptive tiles changes the
    # foreground equalization — the stretch is of the cut-out, not the frame.
    assert not np.array_equal(plain[fg], masked[fg])
    # An all-foreground mask has nothing to neutralise → identical to no mask.
    allfg = np.full((80, 80), 255, np.uint8)
    assert np.array_equal(apply_clahe(gray, 4.0, 8, mask=allfg), plain)


def test_background_alpha_masks_dark():
    from xcs_gen_web.relief import background_alpha

    gray = np.full((10, 10), 100, dtype=np.uint8)
    gray[0, 0] = 0
    gray[1, 1] = 5
    alpha = background_alpha(gray, threshold=8, high=False)
    assert alpha.dtype == np.uint8 and alpha.shape == gray.shape
    assert alpha[0, 0] == 0 and alpha[1, 1] == 0  # dark → transparent
    assert alpha[5, 5] == 255                     # relief → opaque


def test_background_alpha_high_masks_bright():
    from xcs_gen_web.relief import background_alpha

    gray = np.full((10, 10), 100, dtype=np.uint8)
    gray[0, 0] = 255
    alpha = background_alpha(gray, threshold=250, high=True)
    assert alpha[0, 0] == 0 and alpha[5, 5] == 255


def test_encode_png_la_round_trips_alpha():
    from io import BytesIO as _B

    from PIL import Image as _I

    from xcs_gen_web.relief import encode_png_la

    gray = np.full((4, 4), 120, dtype=np.uint8)
    alpha = np.full((4, 4), 255, dtype=np.uint8)
    alpha[0, 0] = 0
    img = _I.open(_B(encode_png_la(gray, alpha)))
    assert img.mode == "LA"
    px = np.array(img)
    assert px[0, 0, 1] == 0 and px[1, 1, 1] == 255


def test_parse_rgb_parses_and_clamps():
    from xcs_gen_web.relief import parse_rgb
    assert parse_rgb("10,20,30") == (10, 20, 30)
    assert parse_rgb("300,-5,40") == (255, 0, 40)  # clamped 0..255
    assert parse_rgb("") is None
    assert parse_rgb("1,2") is None
    assert parse_rgb("a,b,c") is None


def test_colour_background_alpha_keys_picked_colour():
    from xcs_gen_web.relief import colour_background_alpha
    # BGR image: left column a known colour, right column black.
    img = np.zeros((2, 2, 3), np.uint8)
    img[:, 0] = (30, 20, 10)  # BGR → RGB (10, 20, 30)
    alpha = colour_background_alpha(img, (10, 20, 30), 5)
    assert (alpha[:, 0] == 0).all()    # picked colour → background (transparent)
    assert (alpha[:, 1] == 255).all()  # black → foreground


def test_colour_background_alpha_respects_tolerance():
    from xcs_gen_web.relief import colour_background_alpha
    img = np.zeros((1, 2, 3), np.uint8)
    img[0, 0] = (0, 0, 0)    # RGB (0,0,0)
    img[0, 1] = (0, 0, 20)   # BGR → RGB (20,0,0), distance 20 from black
    tight = colour_background_alpha(img, (0, 0, 0), 10)   # 20 > 10 → fg
    assert tight[0, 0] == 0 and tight[0, 1] == 255
    loose = colour_background_alpha(img, (0, 0, 0), 30)   # 20 <= 30 → bg
    assert loose[0, 0] == 0 and loose[0, 1] == 0


def test_trim_alpha_erodes_object_inward():
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((40, 40), np.uint8)
    alpha[10:30, 10:30] = 255            # 20×20 square (short side 20)
    out = trim_alpha(alpha, 10)          # 10% of 20 → radius 2 → shave a 2px ring
    assert out[10, 10] == 0              # corner shaved off
    assert out[20, 20] == 255            # centre kept
    assert int((out > 0).sum()) < int((alpha > 0).sum())


def test_trim_alpha_noop_and_clamp():
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((40, 40), np.uint8)
    alpha[18:22, 18:22] = 255            # 4×4 square
    assert (trim_alpha(alpha, 0) == alpha).all()    # pct 0 → identity
    assert (trim_alpha(alpha, 90) == alpha).all()   # would empty → clamp to input


def test_trim_alpha_guards_negative_and_shape():
    import pytest
    from xcs_gen_web.relief import trim_alpha
    alpha = np.zeros((20, 20), np.uint8)
    alpha[5:15, 5:15] = 255
    assert (trim_alpha(alpha, -5) == alpha).all()   # negative pct → identity
    with pytest.raises(ValueError):
        trim_alpha(np.zeros((4, 4, 3), np.uint8), 10)  # non-2D → ValueError


def test_smooth_perimeter_fills_notches_and_keeps_solid_walls():
    from xcs_gen_web.relief import smooth_perimeter
    gray = np.full((80, 80), 200, np.uint8)
    alpha = np.zeros((80, 80), np.uint8)
    alpha[20:60, 20:60] = 255                         # 40×40 object (short side 40)
    for x in (30, 40, 50):                            # 1px-wide, 5px-deep notches
        alpha[20:25, x] = 0
    out_gray, out_alpha = smooth_perimeter(gray, alpha, 8)  # radius ≈ 3px → wash out
    # The notches are filled: the top edge is now a solid run, opaque + with height.
    assert out_alpha[22, 30] == 255 and out_alpha[22, 40] == 255
    assert out_gray[22, 30] == 200                    # filled pixel took the edge height
    # The object core is untouched.
    assert out_alpha[40, 40] == 255 and out_gray[40, 40] == 200


def test_smooth_perimeter_noop_clamp_and_guards():
    import pytest
    from xcs_gen_web.relief import smooth_perimeter
    gray = np.full((40, 40), 120, np.uint8)
    alpha = np.zeros((40, 40), np.uint8)
    alpha[10:30, 10:30] = 255
    g0, a0 = smooth_perimeter(gray, alpha, 0)         # pct 0 → identity
    assert (g0 == gray).all() and (a0 == alpha).all()
    tiny = np.zeros((40, 40), np.uint8)
    tiny[19:21, 19:21] = 255                          # 2×2 — large pct would erase it
    g1, a1 = smooth_perimeter(gray, tiny, 90)
    assert (a1 == tiny).all()                         # clamp: never erase the object
    with pytest.raises(ValueError):
        smooth_perimeter(gray, np.zeros((40, 20), np.uint8), 5)  # shape mismatch


def test_edge_falloff_inward_down_bevels_to_floor():
    from xcs_gen_web.relief import edge_falloff
    gray = np.full((40, 40), 200, np.uint8)
    alpha = np.zeros((40, 40), np.uint8)
    alpha[5:35, 5:35] = 255                       # 30×30 object (short side 30)
    out, a2 = edge_falloff(gray, alpha, 20, mode="inward", target=0)  # band 6px → floor
    assert out[5, 20] < 80                          # edge ramped toward the floor
    assert out[20, 20] == 200                       # centre (beyond band) unchanged
    assert (a2 == alpha).all()                      # inward leaves the footprint alone
    row = out[20, 5:21].astype(int)                 # edge → centre along a row
    assert (np.diff(row) >= 0).all()                # monotonic non-decreasing


def test_edge_falloff_inward_target_level():
    from xcs_gen_web.relief import edge_falloff
    gray = np.full((40, 40), 100, np.uint8)
    alpha = np.zeros((40, 40), np.uint8)
    alpha[5:35, 5:35] = 255
    up, _ = edge_falloff(gray, alpha, 20, mode="inward", target=255)
    assert up[5, 20] > 180                           # edge ramped toward the peak (255)
    assert up[20, 20] == 100                         # centre (beyond band) unchanged
    out0, a0 = edge_falloff(gray, alpha, 0)
    assert (out0 == gray).all() and (a0 == alpha).all()  # pct 0 → identity


def test_edge_falloff_inward_no_comb_on_notched_boundary():
    from xcs_gen_web.relief import edge_falloff
    # A square with small background notches cut into the top edge. Ramping the
    # edge UP to the peak would spike along those notch "fingers" (the sawtooth
    # comb) unless the boundary is cleaned first.
    gray = np.full((80, 80), 80, np.uint8)
    alpha = np.zeros((80, 80), np.uint8)
    alpha[20:60, 20:60] = 255                         # 40×40 object (short side 40)
    for x in (30, 40, 50):                            # 1px-wide, 4px-deep notches
        alpha[20:24, x] = 0
    out, _ = edge_falloff(gray, alpha, 25, mode="inward", target=255)  # band 10px → peak
    # Along a row 7px inside the (notched) top edge — sampled mid-span to avoid the
    # square's own corner geometry — the ramp must be smooth: no notch should poke
    # up far above its neighbours. (Without cleaning this row combs to ~60 p2p.)
    line = out[27, 30:50].astype(int)
    assert int(np.max(np.abs(np.diff(line)))) < 12     # neighbours stay close → no comb
    assert int(line.max() - line.min()) < 35           # gentle scallop, not a sawtooth


def test_edge_falloff_outward_grows_and_ramps():
    from xcs_gen_web.relief import edge_falloff
    gray = np.full((60, 60), 200, np.uint8)
    alpha = np.zeros((60, 60), np.uint8)
    alpha[20:40, 20:40] = 255                        # 20×20 object (short side 20)
    out, a2 = edge_falloff(gray, alpha, 25, mode="outward", target=0)  # band 5px → floor
    assert int((a2 > 0).sum()) > int((alpha > 0).sum())  # footprint GREW (skirt added)
    assert out[30, 30] == 200                        # object interior untouched
    assert a2[30, 18] == 255                         # a former-background pixel is now opaque skirt
    assert out[30, 18] < 200                         # ...and ramped below the edge height


def test_edge_falloff_outward_berm_crest_and_no_outer_cliff():
    from xcs_gen_web.relief import edge_falloff
    # Outward berm to the peak: the OUTER edge meets the floor (no vertical cliff →
    # no spikes), and the crest (band midline) rises near the target, uniformly.
    gray = np.full((140, 140), 120, np.uint8)
    alpha = np.zeros((140, 140), np.uint8)
    alpha[50:90, 50:90] = 255                          # 40×40 object, band 10px (25%)
    out, a2 = edge_falloff(gray, alpha, 25, mode="outward", target=255)
    assert int((a2 > 0).sum()) > int((alpha > 0).sum())   # footprint grew (berm added)
    # Column above the object's top edge: floor outside → rises to a crest → object.
    col = out[:, 70]
    opaque = a2[:, 70] > 0
    top = int(np.where(opaque)[0].min())               # outermost opaque row of the berm
    assert int(col[top]) < 40                          # outer edge sits at the floor (no cliff)
    crest = int(col[top:top + 11].max())               # crest within the band
    assert crest > 210                                 # berm rises near the peak target
    # The crest height is uniform around the berm (no teeth): sample the top + sides.
    crests = []
    for line in (out[top:top + 11, 70], out[70, top:top + 11]):
        crests.append(int(line.max()))
    assert max(crests) - min(crests) < 30


def test_edge_falloff_outward_berm_fringe_fades_not_opaque_black():
    from xcs_gen_web.relief import edge_falloff
    # Outward berm to the peak on a bright object: the outer slope dips to the
    # floor (gray ~0). The fix makes those near-floor berm pixels TRANSPARENT,
    # so there is no opaque near-black ring against the (transparent) backdrop.
    gray = np.full((140, 140), 220, np.uint8)
    alpha = np.zeros((140, 140), np.uint8)
    alpha[50:90, 50:90] = 255
    out, a2 = edge_falloff(gray, alpha, 25, mode="outward", target=255)
    # No berm pixel may be both opaque AND near-black — that was the ring.
    # (Restrict to grown pixels via the original background mask so the bright
    #  object itself isn't considered.)
    was_bg = alpha == 0
    opaque_black = was_bg & (a2 > 200) & (out < 12)
    assert int(opaque_black.sum()) == 0
    assert int(a2[70, 70]) == 255                          # object interior stays opaque
    # The raised part of the border (well above the floor) is still fully opaque.
    high = (a2 > 0) & was_bg & (out > 180)
    assert int(high.sum()) > 0 and float(a2[high].mean()) > 250
    assert int((a2 > 0).sum()) > int((alpha > 0).sum())    # footprint still grew


def test_edge_falloff_outward_does_not_wall_internal_holes():
    from xcs_gen_web.relief import edge_falloff
    # An annulus: 30×30 object with a 10×10 hole punched in the middle.
    gray = np.full((60, 60), 200, np.uint8)
    alpha = np.zeros((60, 60), np.uint8)
    alpha[15:45, 15:45] = 255
    alpha[25:35, 25:35] = 0                          # internal hole
    out, a2 = edge_falloff(gray, alpha, 25, mode="outward", target=255)  # would-be wall up
    # The hole centre must NOT be raised into a wall (outer-silhouette skirt only).
    assert out[30, 30] == gray[30, 30]
    assert a2[30, 30] == 0                           # hole stays transparent, no skirt inside it


def test_edge_falloff_guards_shape():
    import pytest
    from xcs_gen_web.relief import edge_falloff
    gray = np.zeros((10, 10), np.uint8)
    with pytest.raises(ValueError):
        edge_falloff(np.zeros((10, 10, 3), np.uint8), gray, 20)  # non-2D
    with pytest.raises(ValueError):
        edge_falloff(gray, np.zeros((10, 20), np.uint8), 20)     # shape mismatch


def test_falloff_curve_endpoints_and_intensity():
    from xcs_gen_web.relief import falloff_curve
    for k in (0, 50, 100):
        c = falloff_curve(np.array([0.0, 0.5, 1.0]), k)
        assert abs(float(c[0]) - 0.0) < 1e-9 and abs(float(c[2]) - 1.0) < 1e-9
        assert float(c[0]) <= float(c[1]) <= float(c[2])  # monotonic
    # gentler (low intensity) sits at/above a sharper curve at the midpoint
    mid_gentle = float(falloff_curve(np.array([0.25]), 0)[0])   # linear → 0.25
    mid_sharp = float(falloff_curve(np.array([0.25]), 100)[0])  # smootherstep → lower
    assert mid_gentle > mid_sharp


def test_threshold_background_mask_dark_and_bright():
    from xcs_gen_web.relief import threshold_background_mask
    gray = np.full((4, 4), 100, np.uint8)
    gray[0, 0] = 5
    gray[1, 1] = 250
    dark = threshold_background_mask(gray, 8, high=False)
    assert dark.dtype == bool and dark[0, 0] and not dark[2, 2]
    bright = threshold_background_mask(gray, 200, high=True)
    assert bright[1, 1] and not bright[2, 2]


def test_colour_background_mask_keys_picked_colour():
    from xcs_gen_web.relief import colour_background_mask
    img = np.zeros((2, 2, 3), np.uint8)
    img[:, 0] = (30, 20, 10)  # BGR → RGB (10, 20, 30)
    m = colour_background_mask(img, (10, 20, 30), 5)
    assert m.dtype == bool
    assert m[:, 0].all() and not m[:, 1].any()


def test_area_background_mask_keeps_only_seed_component():
    from xcs_gen_web.relief import area_background_mask
    img = np.zeros((10, 30, 3), np.uint8)        # black background
    img[2:8, 2:8] = (0, 0, 255)                  # BGR red blob A (left)  → RGB (255,0,0)
    img[2:8, 22:28] = (0, 0, 255)                # red blob B (right)
    # seed inside blob A: fractional (x, y)
    m = area_background_mask(img, (255, 0, 0), 10, (5 / 30, 5 / 10))
    assert m.dtype == bool
    assert m[5, 5]            # blob A (seed's component) → background
    assert not m[5, 25]       # blob B same colour but disconnected → kept
    assert not m[0, 0]        # black background → not in colour range


def test_area_background_mask_empty_when_seed_off_colour_or_missing():
    from xcs_gen_web.relief import area_background_mask
    img = np.zeros((10, 10, 3), np.uint8)
    img[2:8, 2:8] = (0, 0, 255)                  # red blob
    # seed on the black background (not within tolerance of red) → empty
    off = area_background_mask(img, (255, 0, 0), 10, (0.0, 0.0))
    assert not off.any()
    # no seed at all → empty
    none = area_background_mask(img, (255, 0, 0), 10, None)
    assert not none.any()


def test_combine_backgrounds_unions_masks():
    from xcs_gen_web.relief import combine_backgrounds
    a = np.zeros((4, 4), bool)
    b = np.zeros((4, 4), bool)
    a[0, 0] = True
    b[3, 3] = True
    alpha = combine_backgrounds([a, b])
    assert alpha.dtype == np.uint8
    assert alpha[0, 0] == 0 and alpha[3, 3] == 0   # either mask → background
    assert alpha[1, 1] == 255                      # neither → foreground


def test_combine_backgrounds_empty_is_all_foreground():
    from xcs_gen_web.relief import combine_backgrounds
    alpha = combine_backgrounds([], shape=(3, 3))
    assert alpha.shape == (3, 3) and (alpha == 255).all()


def test_split_internal_holes_marks_enclosed_background():
    from xcs_gen_web.relief import split_internal_holes
    alpha = np.full((20, 20), 255, np.uint8)     # solid object
    alpha[8:12, 8:12] = 0                          # an enclosed internal hole
    alpha[0, :] = 0                                # border-connected background strip
    solid, holes = split_internal_holes(alpha)
    assert holes.dtype == bool
    assert holes[9, 9]               # enclosed hole detected
    assert not holes[0, 5]           # border background is NOT a hole
    assert solid[9, 9] == 255        # hole filled solid
    assert solid[0, 5] == 0          # border background unchanged in solid


def test_split_internal_holes_no_holes_is_identity():
    from xcs_gen_web.relief import split_internal_holes
    alpha = np.full((10, 10), 255, np.uint8)
    alpha[0, :] = 0                                # only border background
    solid, holes = split_internal_holes(alpha)
    assert not holes.any()
    assert np.array_equal(solid, alpha)
