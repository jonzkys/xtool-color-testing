from xcs_gen_web.text_reg_vocab import to_profile, from_profile, TEXTREG_TO_PROFILE


def test_renames_to_profile_vocab():
    out = to_profile({
        "power": 50, "speed": 1000, "density": 100,
        "repeat": 2, "mopa_frequency": 60, "pulse_width": 200,
        "processing_light_source": "red",
    })
    assert out == {
        "power": 50, "speed": 1000, "density": 100,
        "passes": 2, "frequency": 60, "pulse_width": 200, "laser": "red",
    }


def test_round_trip_is_identity():
    src = {
        "power": 50, "speed": 1000, "density": 100,
        "repeat": 2, "mopa_frequency": 60, "pulse_width": 200,
        "processing_light_source": "red",
    }
    assert from_profile(to_profile(src)) == src


def test_map_is_bijective_on_renamed_keys():
    assert TEXTREG_TO_PROFILE["repeat"] == "passes"
    assert TEXTREG_TO_PROFILE["mopa_frequency"] == "frequency"
    assert TEXTREG_TO_PROFILE["processing_light_source"] == "laser"
