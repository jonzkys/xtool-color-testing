"""Unit tests for the pure aggregator module.

Each aggregator is exercised on a hand-crafted (N, 3) BGR uint8 input where
the expected output is computable by inspection. K-Means tests use a
deliberately bimodal input where the dominant cluster is unambiguous."""

from __future__ import annotations

import numpy as np
import pytest

from xcs_gen.sampling_aggregators import (
    LEGAL_AGGREGATORS,
    aggregate,
    aggregate_kmeans_dominant,
    aggregate_mean,
    aggregate_median,
    aggregate_saturation_median,
    aggregate_trimmed_mean,
)


def test_legal_aggregators_includes_all_five():
    assert set(LEGAL_AGGREGATORS) == {
        "median", "mean", "saturation_median",
        "trimmed_mean", "kmeans_dominant",
    }


def test_aggregate_median_returns_per_channel_median():
    pixels = np.array([
        [10, 20, 30],
        [50, 60, 70],
        [90, 100, 110],
    ], dtype=np.uint8)
    assert aggregate_median(pixels) == (50, 60, 70)


def test_aggregate_mean_returns_per_channel_mean():
    pixels = np.array([
        [10, 20, 30],
        [30, 40, 50],
    ], dtype=np.uint8)
    assert aggregate_mean(pixels) == (20, 30, 40)


def test_aggregate_saturation_median_biases_toward_vivid():
    """Three saturation tiers: 5 grey (sat=0), 5 medium-red (sat≈145),
    5 vivid red (sat=255). Median saturation = 145. With sats >=
    threshold the saturation filter keeps the medium + vivid pixels
    and drops the grey, so the result leans red rather than averaging
    in the grey."""
    grey = np.tile([128, 128, 128], (5, 1)).astype(np.uint8)
    medium = np.tile([60, 60, 140], (5, 1)).astype(np.uint8)
    vivid = np.tile([0, 0, 200], (5, 1)).astype(np.uint8)
    pixels = np.vstack([grey, medium, vivid])
    b, g, r = aggregate_saturation_median(pixels)
    # Result should be in the red family (R > G ≥ B), not grey (R==G==B).
    assert r > 100, f"expected red-leaning result, got ({b}, {g}, {r})"
    assert r > g and r > b, f"expected red-dominant, got ({b}, {g}, {r})"


def test_aggregate_trimmed_mean_drops_outliers():
    """A flat region with two extreme outliers — the trimmed mean should
    reject the outliers and return the bulk."""
    bulk = np.tile([100, 100, 100], (18, 1)).astype(np.uint8)
    outliers = np.array([[0, 0, 0], [255, 255, 255]], dtype=np.uint8)
    pixels = np.vstack([bulk, outliers])
    b, g, r = aggregate_trimmed_mean(pixels, trim=0.10)
    # With trim=0.10 of 20 pixels = 2 dropped at each end; outliers gone.
    assert (b, g, r) == (100, 100, 100)


def test_aggregate_kmeans_dominant_picks_largest_cluster():
    """Two clusters: 70% red, 30% blue. Dominant should be red."""
    red = np.tile([0, 0, 200], (70, 1)).astype(np.uint8)
    blue = np.tile([200, 0, 0], (30, 1)).astype(np.uint8)
    pixels = np.vstack([red, blue])
    b, g, r = aggregate_kmeans_dominant(pixels, n_clusters=2)
    assert r > 150 and b < 50, f"expected red dominant, got ({b}, {g}, {r})"


def test_aggregate_kmeans_falls_back_when_too_few_distinct_pixels():
    """If the cell has fewer distinct colours than n_clusters, KMeans
    can't fit — fall back to plain median rather than crashing."""
    flat = np.tile([100, 110, 120], (10, 1)).astype(np.uint8)
    b, g, r = aggregate_kmeans_dominant(flat, n_clusters=3)
    assert (b, g, r) == (100, 110, 120)


def test_dispatcher_routes_to_correct_function():
    pixels = np.array([[10, 20, 30], [50, 60, 70]], dtype=np.uint8)
    assert aggregate("median", pixels) == aggregate_median(pixels)
    assert aggregate("mean", pixels) == aggregate_mean(pixels)


def test_dispatcher_unknown_raises_value_error():
    pixels = np.array([[10, 20, 30]], dtype=np.uint8)
    with pytest.raises(ValueError, match="unknown aggregator"):
        aggregate("not_a_real_method", pixels)


def test_aggregate_handles_empty_input():
    """Empty input should not crash; return a defined sentinel.
    Covers all five aggregators so a future regression in any one
    function's empty-input guard fails this test."""
    pixels = np.empty((0, 3), dtype=np.uint8)
    assert aggregate_median(pixels) == (0, 0, 0)
    assert aggregate_mean(pixels) == (0, 0, 0)
    assert aggregate_saturation_median(pixels) == (0, 0, 0)
    assert aggregate_trimmed_mean(pixels) == (0, 0, 0)
    assert aggregate_kmeans_dominant(pixels) == (0, 0, 0)
