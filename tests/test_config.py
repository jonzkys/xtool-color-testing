import pytest

from xcs_gen_web.config import Settings


def test_demo_fields_default_to_demo_key_and_user_1(monkeypatch):
    for var in ("XCS_GEN_DEMO_API_KEY", "XCS_GEN_DEMO_TARGET_USER_ID"):
        monkeypatch.delenv(var, raising=False)
    s = Settings.from_env()
    assert s.demo_api_key == "DEMO"
    assert s.demo_target_user_id == 1


def test_demo_api_key_overridable_via_env(monkeypatch):
    monkeypatch.setenv("XCS_GEN_DEMO_API_KEY", "SAMPLE")
    s = Settings.from_env()
    assert s.demo_api_key == "SAMPLE"


def test_demo_target_user_id_overridable_via_env(monkeypatch):
    monkeypatch.setenv("XCS_GEN_DEMO_TARGET_USER_ID", "42")
    s = Settings.from_env()
    assert s.demo_target_user_id == 42


def test_demo_api_key_empty_env_disables_demo(monkeypatch):
    monkeypatch.setenv("XCS_GEN_DEMO_API_KEY", "")
    s = Settings.from_env()
    assert s.demo_api_key == ""
