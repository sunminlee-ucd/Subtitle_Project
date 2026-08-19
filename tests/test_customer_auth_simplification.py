from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_customer_auth_form_has_no_display_name_field() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert 'id="displayName"' not in html
    assert 'id="email" type="email"' in html
    assert 'id="password" type="password"' in html


def test_customer_signup_uses_email_and_password_only() -> None:
    customer = (PORTAL / "customer.js").read_text(encoding="utf-8")
    client = (PORTAL / "supabase-client.js").read_text(encoding="utf-8")

    assert 'client.signUp($("email").value.trim(), $("password").value)' in customer
    assert '$("displayName")' not in customer
    assert "async signUp(email, password)" in client
    assert "display_name" not in client
