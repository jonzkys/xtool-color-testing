"""Unit tests for the per-test canonical-anchor picker."""

from __future__ import annotations

import json

from xcs_gen_web.wb_anchor import (
    FALLBACK_CANONICAL,
    pick_test_canonical,
)


def test_returns_fallback_when_nothing_usable():
    out = pick_test_canonical(
        prior_anchors_json=[],
        candidate_edge_means={"top": None, "right": None, "bottom": None, "left": None},
        candidate_unburned=None,
    )
    assert out == FALLBACK_CANONICAL


def test_picks_brightest_current_edge_when_no_prior():
    edges = {
        "top": (180, 180, 160),     # luma ~177
        "right": (220, 215, 200),   # luma ~215  ← brightest
        "bottom": (140, 145, 130),
        "left": None,
    }
    out = pick_test_canonical(
        prior_anchors_json=[],
        candidate_edge_means=edges,
        candidate_unburned=None,
    )
    assert out == (220.0, 215.0, 200.0)


def test_unburned_competes_with_edges():
    edges = {
        "top": (150, 150, 140),
        "right": (150, 150, 140),
        "bottom": (150, 150, 140),
        "left": (150, 150, 140),
    }
    out = pick_test_canonical(
        prior_anchors_json=[],
        candidate_edge_means=edges,
        candidate_unburned=(230, 220, 210),
    )
    assert out == (230.0, 220.0, 210.0)


def test_prior_flatfield_anchors_are_considered():
    # Prior result was a flat-field row → its anchor JSON is a list of
    # 4 [R,G,B] (top, right, bottom, left).
    prior = json.dumps([
        [200, 200, 180],
        [240, 235, 215],   # ← brightest across the test
        [200, 200, 180],
        [200, 200, 180],
    ])
    out = pick_test_canonical(
        prior_anchors_json=[prior],
        candidate_edge_means={
            "top": (180, 180, 160),
            "right": (180, 180, 160),
            "bottom": (180, 180, 160),
            "left": (180, 180, 160),
        },
        candidate_unburned=None,
    )
    assert out == (240.0, 235.0, 215.0)


def test_prior_chromaticity_anchor_is_considered():
    # Chromaticity-only rows store a single [R,G,B].
    prior = json.dumps([225, 220, 205])
    out = pick_test_canonical(
        prior_anchors_json=[prior],
        candidate_edge_means={"top": None, "right": None, "bottom": None, "left": None},
        candidate_unburned=None,
    )
    assert out == (225.0, 220.0, 205.0)


def test_mixed_prior_and_current_picks_global_max():
    flatfield = json.dumps([
        [180, 180, 160], [180, 180, 160],
        [180, 180, 160], [180, 180, 160],
    ])
    chrom = json.dumps([200, 195, 175])
    out = pick_test_canonical(
        prior_anchors_json=[flatfield, chrom, None],
        candidate_edge_means={
            "top": (250, 245, 225),     # ← brightest, comes from current
            "right": None,
            "bottom": (170, 170, 155),
            "left": (170, 170, 155),
        },
        candidate_unburned=(190, 190, 175),
    )
    assert out == (250.0, 245.0, 225.0)


def test_malformed_prior_json_is_skipped():
    out = pick_test_canonical(
        prior_anchors_json=["not json", "{}", json.dumps("foo"), None],
        candidate_edge_means={
            "top": (160, 160, 145),
            "right": None, "bottom": None, "left": None,
        },
        candidate_unburned=None,
    )
    assert out == (160.0, 160.0, 145.0)


def test_negative_or_nan_components_in_rgb_are_rejected():
    bad = json.dumps([[-1, 200, 200], [float("nan"), 200, 200]])
    out = pick_test_canonical(
        prior_anchors_json=[bad],
        candidate_edge_means={
            "top": (180, 180, 160),
            "right": None, "bottom": None, "left": None,
        },
        candidate_unburned=None,
    )
    # Bad RGBs filtered out — only the current top edge survives.
    assert out == (180.0, 180.0, 160.0)


def test_luminance_uses_rec_601_weights():
    # Pure red (R=255) has luma 76.245; pure green (G=255) has luma 149.685;
    # pure blue (B=255) has luma 29.07. Green should win even though the
    # max-channel value is identical across the three.
    out = pick_test_canonical(
        prior_anchors_json=[],
        candidate_edge_means={
            "top": (255, 0, 0),
            "right": (0, 255, 0),
            "bottom": (0, 0, 255),
            "left": None,
        },
        candidate_unburned=None,
    )
    assert out == (0.0, 255.0, 0.0)
