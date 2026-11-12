"""Access matrix: owner / shared user / stranger x read / write / share."""
import pytest

from app.policy import can
from app.models import Document

OWNER, SHARED, STRANGER = 1, 2, 3


def make_doc() -> Document:
    return Document(id=10, owner_id=OWNER, title="t", content_html="", revision=1,
                    shared_with=frozenset({SHARED}))


@pytest.mark.parametrize(
    "user_id, action, expected",
    [
        (OWNER, "read", True), (OWNER, "write", True), (OWNER, "share", True),
        (SHARED, "read", True), (SHARED, "write", True), (SHARED, "share", False),
        (STRANGER, "read", False), (STRANGER, "write", False), (STRANGER, "share", False),
    ],
)
def test_access_matrix(user_id, action, expected):
    assert can(user_id, make_doc(), action) is expected


def test_unknown_action_is_denied():
    assert can(OWNER, make_doc(), "delete") is False
