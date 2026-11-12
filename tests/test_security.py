from app.security import hash_password, verify_password, sign_session, read_session


def test_password_roundtrip_and_salting():
    h1, h2 = hash_password("demo1234"), hash_password("demo1234")
    assert h1 != h2  # fresh salt every time, no cheap rainbow tables
    assert verify_password("demo1234", h1)
    assert not verify_password("nope", h1)


def test_verify_rejects_garbage_hash():
    assert not verify_password("x", "not-a-hash")


def test_session_roundtrip():
    token = sign_session(42, "secret")
    assert read_session(token, "secret") == 42


def test_session_tampered_or_wrong_secret():
    token = sign_session(42, "secret")
    assert read_session(token, "other") is None
    assert read_session(token + "x", "secret") is None
    assert read_session("garbage", "secret") is None
    assert read_session(None, "secret") is None


def test_session_expired():
    token = sign_session(42, "secret", now=0)
    assert read_session(token, "secret", now=10**9) is None
