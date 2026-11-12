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


# --- version history (stretch) ---
from datetime import datetime, timedelta, timezone  # noqa: E402


def test_at_most_one_snapshot_per_five_minutes(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    d1 = svc.save(repos.alice, doc.id, "<p>one</p>", doc.revision)
    d2 = svc.save(repos.alice, doc.id, "<p>two</p>", d1.revision)
    d3 = svc.save(repos.alice, doc.id, "<p>three</p>", d2.revision)
    assert len(svc.list_versions(repos.alice, doc.id)) == 1  # first save had empty content, 2nd snapshotted
    # age the snapshot past the window, next save should snapshot again
    old = repos.docs.latest_version(doc.id)
    repos.docs._versions[doc.id][0] = type(old)(old.id, old.document_id, old.title,
                                                old.content_html, datetime.now(timezone.utc) - timedelta(minutes=6))
    svc.save(repos.alice, doc.id, "<p>four</p>", d3.revision)
    assert len(svc.list_versions(repos.alice, doc.id)) == 2


def test_restore_version(env):
    repos, svc = env
    doc = svc.create(repos.alice, "T")
    d1 = svc.save(repos.alice, doc.id, "<p>one</p>", doc.revision)
    d2 = svc.save(repos.alice, doc.id, "<p>two</p>", d1.revision)
    v = svc.list_versions(repos.alice, doc.id)[0]
    restored = svc.restore_version(repos.alice, doc.id, v.id)
    assert restored.content_html == v.content_html and restored.revision == d2.revision + 1
    with pytest.raises(AppError) as e:
        svc.restore_version(repos.alice, doc.id, 999)
    assert e.value.status == 404
