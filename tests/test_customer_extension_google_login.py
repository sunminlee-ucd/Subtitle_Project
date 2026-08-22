from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "customer_extension"


def test_customer_extension_exposes_google_sign_in_button() -> None:
    html = (EXTENSION / "popup.html").read_text(encoding="utf-8")
    css = (EXTENSION / "google-auth.css").read_text(encoding="utf-8")
    logo = (EXTENSION / "google-g.svg").read_text(encoding="utf-8")

    assert 'id="googleSignIn"' in html
    assert 'id="googleSignInLabel"' in html
    assert "Continue with Google" in html
    assert 'src="google-g.svg"' in html
    assert '<link rel="stylesheet" href="google-auth.css">' in html
    assert '<script src="google-auth-ui.js"></script>' in html
    assert ".google-signin-button" in css
    for color in ("#4285F4", "#34A853", "#FBBC05", "#EA4335"):
        assert color in logo


def test_customer_extension_uses_chrome_identity_and_background_oauth() -> None:
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    background = (EXTENSION / "background.js").read_text(encoding="utf-8")
    oauth = (EXTENSION / "google-oauth.js").read_text(encoding="utf-8")
    ui = (EXTENSION / "google-auth-ui.js").read_text(encoding="utf-8")

    expected_imports = (
        'importScripts("config.js", "supabase-client.js", '
        '"google-oauth.js", "subtitle-core.js")'
    )
    assert "identity" in manifest["permissions"]
    assert manifest["version"] == "0.3.4"
    assert expected_imports in background
    assert 'message?.type === "CUSTOMER_GOOGLE_SIGN_IN"' in background
    assert "CustomerGoogleOAuth.launch(client)" in background
    assert 'type: "CUSTOMER_GOOGLE_SIGN_IN"' in ui
    assert "chrome.identity.getRedirectURL(\"google\")" in oauth
    assert "chrome.identity.launchWebAuthFlow" in oauth


def test_google_oauth_uses_pkce_and_existing_supabase_session_storage() -> None:
    oauth = (EXTENSION / "google-oauth.js").read_text(encoding="utf-8")

    assert 'authUrl.searchParams.set("provider", PROVIDER)' in oauth
    assert 'authUrl.searchParams.set("code_challenge", challenge)' in oauth
    assert 'authUrl.searchParams.set("code_challenge_method", "s256")' in oauth
    assert "/auth/v1/token?grant_type=pkce" in oauth
    assert "code_verifier: verifier" in oauth
    assert "await client.saveSession(session)" in oauth
    assert "client_secret" not in oauth.lower()
    assert "googleusercontent.com" not in oauth.lower()


@pytest.mark.parametrize(
    "filename",
    ["google-oauth.js", "google-auth-ui.js", "background.js"],
)
def test_customer_google_login_javascript_is_valid(filename: str) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    subprocess.run(
        [node, "--check", str(EXTENSION / filename)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
