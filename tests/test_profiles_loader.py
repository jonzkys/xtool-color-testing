import json
import pytest
from xcs_gen.profiles_loader import load_profiles, validate_profiles


def _write(tmp_path, obj):
    p = tmp_path / "machine_profiles.json"
    p.write_text(json.dumps(obj))
    return p


def test_loads_valid_profiles(tmp_path):
    path = _write(tmp_path, {
        "meta": {"source": "x"},
        "profiles": {
            "F2Ultra:cut": {
                "power": {"kind": "range", "min": 1, "max": 100, "step": 1},
                "pulse_width": {"kind": "not_applicable"},
                "laser": {"kind": "enum", "values": ["red", "blue"]},
            },
        },
    })
    profiles = load_profiles(path)
    assert profiles["F2Ultra:cut"]["power"]["max"] == 100


def test_rejects_unknown_kind(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"power": {"kind": "wat"}}}})
    with pytest.raises(ValueError, match="unknown constraint kind"):
        load_profiles(path)


def test_rejects_inverted_range(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"speed": {"kind": "range", "min": 10, "max": 2}}}})
    with pytest.raises(ValueError, match="invalid range"):
        load_profiles(path)


def test_rejects_empty_stepped(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"pw": {"kind": "stepped", "values": []}}}})
    with pytest.raises(ValueError, match="non-empty"):
        load_profiles(path)


def test_committed_file_is_valid():
    # The real committed machine_profiles.json must always pass validation.
    from xcs_gen.profiles_loader import load_profiles as lp, DEFAULT_PATH
    lp(DEFAULT_PATH)  # raises ValueError if the committed file is malformed


def test_rejects_non_dict_constraint(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"power": 100}}})
    with pytest.raises(ValueError, match="must be a dict"):
        load_profiles(path)


def test_rejects_non_numeric_range_bounds(tmp_path):
    path = _write(tmp_path, {"profiles": {"P": {"speed": {"kind": "range", "min": "lo", "max": "hi"}}}})
    with pytest.raises(ValueError, match="invalid range"):
        load_profiles(path)


def test_rejects_missing_profiles_key(tmp_path):
    path = _write(tmp_path, {"meta": {"source": "x"}})
    with pytest.raises(ValueError, match="missing the 'profiles' key"):
        load_profiles(path)
