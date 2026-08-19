import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_customer_and_admin_show_remember_login_checkbox() -> None:
    customer = (PORTAL / "index.html").read_text(encoding="utf-8")
    admin = (PORTAL / "admin.html").read_text(encoding="utf-8")

    for html in (customer, admin):
        assert 'id="rememberLogin" type="checkbox"' in html
        assert "Keep me signed in" in html
        assert "/portal-assets/auth-session.css?v=20260819-1" in html
        assert "/portal-assets/supabase-client.js?v=20260819-4" in html


def test_remember_login_changes_real_session_storage() -> None:
    source = (PORTAL / "supabase-client.js").read_text(encoding="utf-8")

    assert "sessionStorage" in source
    assert "localStorage" in source
    assert 'document.getElementById("rememberLogin")?.checked' in source
    assert "const target = persistent ? localStorage : sessionStorage" in source
    assert "const other = persistent ? sessionStorage : localStorage" in source
    assert "target.setItem(this.sessionKey, JSON.stringify(saved))" in source
    assert "other.removeItem(this.sessionKey)" in source
    assert "this.clearStoredSession()" in source


def test_customer_and_admin_sessions_are_isolated() -> None:
    source = (PORTAL / "supabase-client.js").read_text(encoding="utf-8")

    assert '"subtitlePortalAdminSession"' in source
    assert '"subtitlePortalCustomerSession"' in source
    assert 'startsWith("/admin")' in source


def test_password_is_not_written_to_browser_storage() -> None:
    source = (PORTAL / "supabase-client.js").read_text(encoding="utf-8")
    storage_writes = [line for line in source.splitlines() if ".setItem(" in line]

    assert storage_writes
    assert all("password" not in line.lower() for line in storage_writes)


def test_remember_login_control_is_compact_and_mobile_friendly() -> None:
    styles = (PORTAL / "auth-session.css").read_text(encoding="utf-8")

    assert ".remember-login" in styles
    assert 'input[type="checkbox"]' in styles
    assert "width:16px" in styles
    assert "@media (max-width:760px)" in styles
    assert "width:18px" in styles


def test_supabase_portal_client_javascript_is_valid() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")
    subprocess.run(
        [node, "--check", str(PORTAL / "supabase-client.js")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


def test_session_storage_behavior_with_node() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    script = r"""
function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
global.localStorage = storage();
global.sessionStorage = storage();
global.location = { pathname: "/customer" };
require(process.argv[1]);
const Client = global.PortalSupabase.PortalSupabaseClient;
const config = {
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};
const session = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
  user: { id: "u" },
};

const customer = new Client(config);
customer.saveSession(session, false);
if (!sessionStorage.getItem("subtitlePortalCustomerSession")) process.exit(10);
if (localStorage.getItem("subtitlePortalCustomerSession")) process.exit(11);
customer.saveSession(session, true);
if (!localStorage.getItem("subtitlePortalCustomerSession")) process.exit(12);
if (sessionStorage.getItem("subtitlePortalCustomerSession")) process.exit(13);

global.location.pathname = "/admin";
const admin = new Client(config);
admin.saveSession(session, true);
if (!localStorage.getItem("subtitlePortalAdminSession")) process.exit(14);
if (!localStorage.getItem("subtitlePortalCustomerSession")) process.exit(15);
"""
    subprocess.run(
        [node, "-e", script, str(PORTAL / "supabase-client.js")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
