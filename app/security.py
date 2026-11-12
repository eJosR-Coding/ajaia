"""scrypt password hashing + HMAC-signed session tokens, stdlib only."""
import base64
import hashlib
import hmac
import secrets
import time

_N, _R, _P = 2**14, 8, 1
SESSION_TTL = 7 * 24 * 3600


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, dk_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=_N, r=_R, p=_P)
        return hmac.compare_digest(dk, bytes.fromhex(dk_hex))
    except ValueError:
        return False


def _mac(payload: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def sign_session(user_id: int, secret: str, now: float | None = None) -> str:
    issued = int(time.time() if now is None else now)
    payload = base64.urlsafe_b64encode(f"{user_id}:{issued}".encode()).decode()
    return f"{payload}.{_mac(payload, secret)}"


def read_session(token: str | None, secret: str, now: float | None = None) -> int | None:
    if not token or "." not in token:
        return None
    payload, mac = token.rsplit(".", 1)
    if not hmac.compare_digest(mac, _mac(payload, secret)):
        return None
    try:
        uid, issued = base64.urlsafe_b64decode(payload.encode()).decode().split(":")
        current = time.time() if now is None else now
        if current - int(issued) > SESSION_TTL:
            return None
        return int(uid)
    except ValueError:
        return None
