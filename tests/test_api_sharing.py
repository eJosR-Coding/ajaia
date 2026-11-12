"""End-to-end through HTTP with in-memory repos swapped in."""
import pytest
from fastapi.testclient import TestClient

from app import deps
from app.main import create_app
from app.deps import Settings
from tests.fakes import FakeRepos


@pytest.fixture
def repos():
    return FakeRepos()


@pytest.fixture
def app(repos):
    app = create_app()
    app.dependency_overrides[deps.get_repos] = lambda: repos
    app.dependency_overrides[deps.get_settings] = lambda: Settings(
        database_url="", session_secret="test-secret", cookie_secure=False)
    app.dependency_overrides[deps.check_db] = lambda: True
    return app


def login(app, email, password="demo1234") -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def test_health(app):
    assert TestClient(app).get("/api/health").json() == {"status": "ok", "db": "ok"}


def test_login_cookie_flags_and_me(app):
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"email": "alice@demo.com", "password": "demo1234"})
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert c.get("/api/me").json()["email"] == "alice@demo.com"


def test_bad_login_and_unauthenticated_shape(app):
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"email": "alice@demo.com", "password": "wrong"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
    r = c.get("/api/documents")
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"


def test_logout_clears_session(app):
    c = login(app, "alice@demo.com")
    c.post("/api/auth/logout")
    assert c.get("/api/me").status_code == 401


def test_alice_shares_bob_sees_carol_404(app):
    alice, bob, carol = (login(app, f"{n}@demo.com") for n in ("alice", "bob", "carol"))
    doc = alice.post("/api/documents", json={"title": "Plan"}).json()
    assert alice.post(f"/api/documents/{doc['id']}/shares", json={"email": "bob@demo.com"}).status_code == 200

    listing = bob.get("/api/documents").json()
    assert [d["id"] for d in listing["shared"]] == [doc["id"]] and listing["owned"] == []
    assert "content_html" not in listing["shared"][0]  # metadata only

    r = carol.get(f"/api/documents/{doc['id']}")
    assert r.status_code == 404 and r.json() == {"error": {"code": "not_found", "message": "Document not found"}}
    assert carol.put(f"/api/documents/{doc['id']}", json={"content_html": "x", "revision": 1}).status_code == 404


def test_shared_user_edits_but_cannot_share(app):
    alice, bob = login(app, "alice@demo.com"), login(app, "bob@demo.com")
    doc = alice.post("/api/documents", json={}).json()
    alice.post(f"/api/documents/{doc['id']}/shares", json={"email": "bob@demo.com"})
    r = bob.put(f"/api/documents/{doc['id']}", json={"content_html": "<p>bob</p>", "revision": doc["revision"]})
    assert r.status_code == 200 and r.json()["revision"] == doc["revision"] + 1
    r = bob.post(f"/api/documents/{doc['id']}/shares", json={"email": "carol@demo.com"})
    assert r.status_code == 403
    assert bob.get(f"/api/documents/{doc['id']}/shares").status_code == 403


def test_stale_revision_returns_409(app):
    alice, bob = login(app, "alice@demo.com"), login(app, "bob@demo.com")
    doc = alice.post("/api/documents", json={}).json()
    alice.post(f"/api/documents/{doc['id']}/shares", json={"email": "bob@demo.com"})
    body = {"content_html": "<p>a</p>", "revision": doc["revision"]}
    assert alice.put(f"/api/documents/{doc['id']}", json=body).status_code == 200
    r = bob.put(f"/api/documents/{doc['id']}", json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_owner_lists_shares_and_rename(app):
    alice = login(app, "alice@demo.com")
    doc = alice.post("/api/documents", json={"title": "A"}).json()
    alice.post(f"/api/documents/{doc['id']}/shares", json={"email": "bob@demo.com"})
    shares = alice.get(f"/api/documents/{doc['id']}/shares").json()
    assert [s["email"] for s in shares] == ["bob@demo.com"]
    r = alice.patch(f"/api/documents/{doc['id']}", json={"title": "Renamed"})
    assert r.json()["title"] == "Renamed"


def test_validation_error_uses_single_shape(app):
    alice = login(app, "alice@demo.com")
    r = alice.put("/api/documents/1", json={"nope": 1})
    assert r.status_code == 422 and set(r.json()["error"]) == {"code", "message"}


def test_versions_endpoints(app):
    alice, carol = login(app, "alice@demo.com"), login(app, "carol@demo.com")
    doc = alice.post("/api/documents", json={}).json()
    r1 = alice.put(f"/api/documents/{doc['id']}", json={"content_html": "<p>one</p>", "revision": 1}).json()
    alice.put(f"/api/documents/{doc['id']}", json={"content_html": "<p>two</p>", "revision": r1["revision"]})
    versions = alice.get(f"/api/documents/{doc['id']}/versions").json()
    assert len(versions) == 1 and "content_html" not in versions[0]
    r = alice.post(f"/api/documents/{doc['id']}/versions/{versions[0]['id']}/restore")
    assert r.status_code == 200 and r.json()["content_html"] == "<p>one</p>"
    assert carol.get(f"/api/documents/{doc['id']}/versions").status_code == 404
