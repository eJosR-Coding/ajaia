"""All authorization lives here. One function, no surprises."""
from app.models import Document

# action -> who is allowed (owner always is)
_SHARED_CAN = {"read", "write"}
_ALL = {"read", "write", "share"}


def can(user_id: int, doc: Document, action: str) -> bool:
    if action not in _ALL:
        return False
    if doc.owner_id == user_id:
        return True
    return user_id in doc.shared_with and action in _SHARED_CAN
