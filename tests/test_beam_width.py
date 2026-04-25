"""Beam-spot warning: derives from the machine's fiber laser by default."""

from __future__ import annotations

from xcs_gen_web import converter


def test_default_beam_width_matches_f2_fiber():
    # Backwards-compat default — F2 fiber is 0.03mm.
    assert converter.beam_width_for_machine("F2Ultra") == 0.03


def test_beam_width_for_f1_fiber():
    assert converter.beam_width_for_machine("F1Ultra") == 0.03


def test_beam_width_uses_min_spot_dimension():
    # Blue laser is rectangular (0.08, 0.10); the warning uses the
    # smaller dimension because that's what bounds adjacent-element
    # collisions on the narrow axis.
    assert converter.beam_width_for_machine("F2Ultra", laser="blue") == 0.08
