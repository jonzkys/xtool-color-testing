"""Tests for DemoReadOnlyMiddleware — the outermost guard that rejects
non-allowlisted writes carrying the demo API key.

The middleware is unit-tested directly against a minimal FastAPI app so
a single test pins down the behaviour without dragging the full
``create_app`` wiring into the loop.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from xcs_gen_web.demo import DemoReadOnlyMiddleware


def make_app(demo_api_key: str = "DEMO") -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        DemoReadOnlyMiddleware,
        demo_api_key=demo_api_key,
        user_header="X-User-Id",
    )

    @app.get("/api/tests")
    def list_tests():
        return {"ok": True}

    @app.post("/api/tests")
    def create_test():
        return {"ok": True}

    @app.patch("/api/tests/{tid}")
    def patch_test(tid: int):
        return {"ok": True}

    @app.delete("/api/tests/{tid}")
    def delete_test(tid: int):
        return {"ok": True}

    @app.post("/api/svg-layers")
    def gen_layers():
        return {"ok": True}

    @app.post("/api/svg-preview")
    def gen_preview():
        return {"ok": True}

    @app.post("/api/results/preflight")
    def preflight():
        return {"ok": True}

    return app


def test_demo_get_passes_through():
    client = TestClient(make_app())
    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 200


def test_demo_post_to_non_allowlisted_is_blocked():
    client = TestClient(make_app())
    resp = client.post("/api/tests", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "demo account is read-only"}


def test_demo_patch_is_blocked():
    client = TestClient(make_app())
    resp = client.patch("/api/tests/7", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 403


def test_demo_delete_is_blocked():
    client = TestClient(make_app())
    resp = client.delete("/api/tests/7", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 403


def test_demo_post_to_svg_layers_is_allowed():
    client = TestClient(make_app())
    resp = client.post("/api/svg-layers", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 200


def test_demo_post_to_svg_preview_is_allowed():
    client = TestClient(make_app())
    resp = client.post("/api/svg-preview", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 200


def test_demo_post_to_preflight_is_allowed():
    client = TestClient(make_app())
    resp = client.post(
        "/api/results/preflight", headers={"X-User-Id": "DEMO"}, json={},
    )
    assert resp.status_code == 200


def test_non_demo_user_post_passes_through():
    client = TestClient(make_app())
    resp = client.post(
        "/api/tests", headers={"X-User-Id": "fsp9KYfD7zRUL507"}, json={},
    )
    assert resp.status_code == 200


def test_no_header_post_passes_through():
    client = TestClient(make_app())
    resp = client.post("/api/tests", json={})
    assert resp.status_code == 200


def test_empty_demo_key_disables_middleware():
    # When demo_api_key is empty, no header value should trip the block.
    client = TestClient(make_app(demo_api_key=""))
    resp = client.post("/api/tests", headers={"X-User-Id": ""}, json={})
    assert resp.status_code == 200
    resp = client.post("/api/tests", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 200


def test_header_whitespace_is_trimmed():
    # Leading/trailing whitespace on the X-User-Id header shouldn't
    # sneak a demo identity past the check.
    client = TestClient(make_app())
    resp = client.post("/api/tests", headers={"X-User-Id": " DEMO "}, json={})
    assert resp.status_code == 403


def test_get_is_never_blocked_even_with_demo_header():
    client = TestClient(make_app())
    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 200


def test_lowercase_demo_header_is_not_blocked():
    # "demo" != "DEMO" — case matters. A user whose real API key
    # happens to be lowercase "demo" must not be treated as the demo
    # identity.
    client = TestClient(make_app())
    resp = client.post("/api/tests", headers={"X-User-Id": "demo"}, json={})
    assert resp.status_code == 200


def test_mixedcase_demo_header_is_not_blocked():
    client = TestClient(make_app())
    resp = client.post("/api/tests", headers={"X-User-Id": "Demo"}, json={})
    assert resp.status_code == 200
