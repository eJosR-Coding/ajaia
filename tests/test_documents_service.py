"""Service rules: optimistic locking, sanitization, sharing, access."""
import pytest

from app.errors import AppError
from app.services import DocumentService
from tests.fakes import FakeRepos


@pytest.fixture
def env():
    repos = FakeRepos()
    return repos, DocumentService(repos.docs, repos.users)


def test_conflicting_revision_raises_conflict(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    svc.save(repos.alice, doc.id, "<p>one</p>", doc.revision)
    with pytest.raises(AppError) as e:
        svc.save(repos.alice, doc.id, "<p>two</p>", doc.revision)  # stale revision
    assert e.value.status == 409 and e.value.code == "conflict"


def test_save_bumps_revision(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    assert svc.save(repos.alice, doc.id, "<p>x</p>", doc.revision).revision == doc.revision + 1


def test_script_and_event_handlers_stripped(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    saved = svc.save(repos.alice, doc.id,
                     '<p onclick="x()">hi</p><script>alert(1)</script><img src=x onerror=y>',
                     doc.revision)
    assert "script" not in saved.content_html and "onclick" not in saved.content_html
    assert "onerror" not in saved.content_html and "<img" not in saved.content_html
    assert "hi" in saved.content_html


def test_stranger_gets_not_found(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    for call in (lambda: svc.get(repos.carol, doc.id),
                 lambda: svc.save(repos.carol, doc.id, "<p>x</p>", 1),
                 lambda: svc.rename(repos.carol, doc.id, "x")):
        with pytest.raises(AppError) as e:
            call()
        assert e.value.status == 404 and e.value.code == "not_found"


def test_missing_doc_is_not_found(env):
    repos, svc = env
    with pytest.raises(AppError) as e:
        svc.get(repos.alice, 999)
    assert e.value.status == 404


def test_only_owner_can_share(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    svc.share(repos.alice, doc.id, "bob@demo.com")
    with pytest.raises(AppError) as e:
        svc.share(repos.bob, doc.id, "carol@demo.com")  # shared user: can read, not share
    assert e.value.status == 403 and e.value.code == "forbidden"
    with pytest.raises(AppError) as e:
        svc.share(repos.carol, doc.id, "carol@demo.com")  # stranger: pretend it doesn't exist
    assert e.value.status == 404


def test_share_unknown_email_and_self(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    with pytest.raises(AppError) as e:
        svc.share(repos.alice, doc.id, "ghost@demo.com")
    assert e.value.status == 404 and e.value.code == "user_not_found"
    with pytest.raises(AppError) as e:
        svc.share(repos.alice, doc.id, "alice@demo.com")
    assert e.value.status == 400


def test_list_splits_owned_and_shared(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    svc.share(repos.alice, doc.id, "bob@demo.com")
    owned, shared = svc.list(repos.bob)
    assert owned == [] and [d.id for d in shared] == [doc.id]


def test_import_creates_sanitized_titled_doc(env):
    repos, svc = env
    doc = svc.import_file(repos.alice, "plan.md", "# Roadmap\n\n- a\n\n<script>x</script>")
    assert doc.title == "Roadmap" and "<h1>Roadmap</h1>" in doc.content_html
    assert "script" not in doc.content_html


def test_rename_validates_title(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    assert svc.rename(repos.alice, doc.id, "  New  ").title == "New"
    with pytest.raises(AppError) as e:
        svc.rename(repos.alice, doc.id, "   ")
    assert e.value.status == 400
