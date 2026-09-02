"""BUY-75313 keyless GET identity helpers."""
from app.auth import AnonymousIdentity, ANONYMOUS_DAILY, ANONYMOUS_RPM, ANON_REGISTER_HINT, _ip_hash


def test_anonymous_limits_match_self_serve():
    assert ANONYMOUS_RPM == 60
    assert ANONYMOUS_DAILY == 1000


def test_anonymous_identity_shape():
    h = _ip_hash("1.2.3.4")
    ident = AnonymousIdentity(h)
    assert ident.tier == "anonymous"
    assert ident.id == f"anon:{h}"
    assert len(h) == 32


def test_register_hint_points_at_verify_false():
    assert ANON_REGISTER_HINT["method"] == "POST"
    assert "register?verify=false" in ANON_REGISTER_HINT["url"]
