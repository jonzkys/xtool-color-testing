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

    @app.post("/api/svg-stack")
    def gen_svg_stack():
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


# --- End-to-end: demo key resolves to the target user + middleware wires in.

def test_demo_key_resolves_to_target_user_in_deps():
    """Full create_app wiring: DEMO header returns the target user's
    data on a GET, and is blocked on a POST to a non-allowlisted route."""
    from xcs_gen_web.app import create_app
    from xcs_gen_web.config import Settings

    settings = Settings(
        mode="multi_user",
        db_url="sqlite:///:memory:",
        auto_migrate=True,
        demo_api_key="DEMO",
        demo_target_user_id=1,
    )
    app = create_app(settings=settings)
    client = TestClient(app)

    # GET hits the repo layer. With an empty test DB the target user
    # has no tests yet — but the call succeeds (200, empty list), which
    # proves the demo key resolved to an owner_id without 401.
    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    assert resp.status_code == 200
    assert resp.json() == []

    # Non-allowlisted POST is 403 (middleware).
    resp = client.post(
        "/api/tests",
        headers={"X-User-Id": "DEMO", "Content-Type": "application/json"},
        json={"name": "should not persist", "spec": {}},
    )
    assert resp.status_code == 403
    assert resp.json() == {"detail": "demo account is read-only"}


def test_demo_disabled_when_key_is_empty():
    """With ``demo_api_key=""`` in settings, sending X-User-Id: DEMO
    behaves like any unregistered key — 401 from deps, NOT 403."""
    from xcs_gen_web.app import create_app
    from xcs_gen_web.config import Settings

    settings = Settings(
        mode="multi_user",
        db_url="sqlite:///:memory:",
        auto_migrate=True,
        demo_api_key="",
    )
    app = create_app(settings=settings)
    client = TestClient(app)

    resp = client.get("/api/tests", headers={"X-User-Id": "DEMO"})
    # DEMO is not a valid base64url 16-char key; deps returns 401.
    assert resp.status_code == 401


def test_demo_post_to_svg_stack_is_allowed():
    client = TestClient(make_app())
    resp = client.post("/api/svg-stack", headers={"X-User-Id": "DEMO"}, json={})
    assert resp.status_code == 200


def test_demo_middleware_not_registered_in_standalone_mode():
    """In standalone mode the demo middleware is never registered, so
    a POST with X-User-Id: DEMO passes straight through (standalone
    ignores the header entirely)."""
    from xcs_gen_web.app import create_app
    from xcs_gen_web.config import Settings

    settings = Settings(
        mode="standalone",
        demo_api_key="DEMO",
        demo_target_user_id=1,
    )
    app = create_app(settings=settings)
    client = TestClient(app)

    resp = client.post(
        "/api/tests",
        headers={"X-User-Id": "DEMO"},
        json={"name": "standalone", "spec": {}},
    )
    # Standalone mode must NOT return the demo 403 — the handler (or a
    # later validation error) must reach it.
    assert resp.status_code != 403
