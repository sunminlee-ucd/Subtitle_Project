import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"
SCHEMA = ROOT / "supabase" / "schema.sql"


def test_customer_portal_exposes_google_login_button() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")
    styles = (PORTAL / "auth-session.css").read_text(encoding="utf-8")

    assert 'id="googleSignIn"' in html
    assert "Continue with Google" in html
    assert 'class="google-signin-button"' in html
    assert ".google-signin-button" in styles
    assert ".auth-divider" in styles


def test_google_button_uses_official_color_logo_asset() -> None:
    styles = (PORTAL / "auth-session.css").read_text(encoding="utf-8")

    assert "https://developers.google.com/identity/images/g-logo.png" in styles
    assert "center/18px 18px no-repeat" in styles
    assert "font-size:0" in styles
    assert "color:#4285f4" not in styles


def test_google_login_uses_supabase_oauth_and_provider_check() -> None:
    script = (PORTAL / "customer.js").read_text(encoding="utf-8")

    assert '$("googleSignIn").addEventListener("click", signInWithGoogle)' in script
    assert "/auth/v1/settings" in script
    assert "settings?.external?.google" in script
    assert 'provider: "google"' in script
    assert "/auth/v1/authorize?" in script
    assert 'redirect_to: `${location.origin}/customer`' in script


def test_google_oauth_callback_restores_supabase_user_session() -> None:
    script = (PORTAL / "customer.js").read_text(encoding="utf-8")

    assert "await googleSessionFromUrl()" in script
    assert 'hash.get("access_token")' in script
    assert 'hash.get("refresh_token")' in script
    assert "/auth/v1/user" in script
    assert "client.saveSession({...session, user:signedInUser}, persistent)" in script
    assert "client.clearStoredSession()" in script
    assert "clearAuthHash()" in script


def test_google_login_respects_keep_signed_in_choice() -> None:
    script = (PORTAL / "customer.js").read_text(encoding="utf-8")

    assert 'GOOGLE_OAUTH_PERSIST_KEY = "subtitlePortalCustomerGooglePersistent"' in script
    assert '$("rememberLogin").checked ? "1" : "0"' in script
    assert 'sessionStorage.getItem(GOOGLE_OAUTH_PERSIST_KEY) === "1"' in script
    assert "client.saveSession({" in script
    assert "}, persistent);" in script


def test_google_auth_users_are_compatible_with_profile_trigger() -> None:
    sql = SCHEMA.read_text(encoding="utf-8").lower()

    assert "create or replace function private.handle_new_user()" in sql
    assert "coalesce(new.email, '')" in sql
    assert "after insert or update of email on auth.users" in sql


def test_customer_javascript_is_valid_after_google_login_change() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    subprocess.run(
        [node, "--check", str(PORTAL / "customer.js")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
