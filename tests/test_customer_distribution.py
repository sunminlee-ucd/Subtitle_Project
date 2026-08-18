from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "customer_extension"
PORTAL = ROOT / "customer_portal"
SCHEMA = ROOT / "supabase" / "schema.sql"


def test_customer_manifest_has_no_capture_or_download_capabilities() -> None:
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))

    assert "downloads" not in manifest.get("permissions", [])
    assert "webRequest" not in manifest.get("permissions", [])
    scripts = " ".join(
        item
        for content_script in manifest["content_scripts"]
        for item in content_script.get("js", [])
    )
    assert "probe" not in scripts.lower()
    assert "capture" not in scripts.lower()


def test_customer_extension_has_no_export_or_local_subtitle_input() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for path in EXTENSION.glob("*")
        if path.suffix in {".js", ".html"}
    ).lower()

    assert "chrome.downloads" not in source
    assert "createobjecturl" not in source
    assert 'accept=".srt"' not in source
    assert "capturedrow" not in source


def test_public_clients_contain_no_privileged_supabase_key() -> None:
    source = "\n".join(
        path.read_text(encoding="utf-8")
        for folder in (EXTENSION, PORTAL)
        for path in folder.glob("*.js")
    ).lower()

    assert "sb_secret_" not in source
    assert "service_role" not in source
    assert "sb_publishable_" in source


def test_every_exposed_table_has_rls_and_customer_grant_policy() -> None:
    sql = SCHEMA.read_text(encoding="utf-8").lower()
    tables = (
        "profiles",
        "admin_users",
        "videos",
        "subtitle_tracks",
        "subtitle_grants",
        "video_requests",
        "error_reports",
    )
    for table in tables:
        assert f"alter table public.{table} enable row level security" in sql

    assert "grant_row.customer_id = (select auth.uid())" in sql
    assert "private.can_access_subtitle(id)" in sql
    assert "create or replace function public.can_access_subtitle" not in sql
    assert "customer_id = (select auth.uid())" in sql
    assert "revoke all on all tables in schema public from anon, authenticated" in sql


def test_customer_and_admin_web_routes_exist() -> None:
    main_source = (ROOT / "app" / "main.py").read_text(encoding="utf-8")
    assert '@app.get("/customer"' in main_source
    assert '@app.get("/admin"' in main_source
    assert (PORTAL / "index.html").exists()
    assert (PORTAL / "admin.html").exists()


def test_private_srt_storage_is_authorized_by_customer_grant() -> None:
    sql = SCHEMA.read_text(encoding="utf-8").lower()
    extension_client = (EXTENSION / "supabase-client.js").read_text(encoding="utf-8")
    popup = (EXTENSION / "popup.js").read_text(encoding="utf-8")
    background = (EXTENSION / "background.js").read_text(encoding="utf-8")
    admin = (PORTAL / "admin.js").read_text(encoding="utf-8")

    assert "'subtitle-files'" in sql
    assert "public = false" in sql
    assert "subtitle_files_select_authorized" in sql
    assert "private.can_access_subtitle(track.id)" in sql
    assert "storage_path = name" in sql
    assert "/storage/v1/object/authenticated/" in extension_client
    assert 'downloadStorageText("subtitle-files"' in popup
    assert 'downloadStorageText("subtitle-files"' in background
    assert 'uploadStorage("subtitle-files"' in admin
    assert 'storagePath=`${track.id}.srt`' in admin


def test_customer_srt_parser_with_node() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")
    subprocess.run(
        [node, str(ROOT / "tests" / "customer_subtitle_core_smoke.js")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


def test_public_root_redirects_to_customer_portal() -> None:
    main_source = (ROOT / "app" / "main.py").read_text(encoding="utf-8")

    assert 'RedirectResponse(url="/customer?view=request", status_code=307)' in main_source
    assert 'app.mount("/static"' not in main_source


def test_customer_forms_keep_a_stable_reference_across_async_requests() -> None:
    source = (PORTAL / "customer.js").read_text(encoding="utf-8")

    assert source.count("const form = event.currentTarget;") == 2
    assert "event.currentTarget.reset()" not in source


def test_portal_assets_are_not_cached_between_deployments() -> None:
    main_source = (ROOT / "app" / "main.py").read_text(encoding="utf-8")
    customer_html = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert 'response.headers["Cache-Control"] = "no-store"' in main_source
    assert 'customer.js?v=20260817-1' in customer_html


def test_admin_can_securely_set_or_reset_own_password() -> None:
    admin_html = (PORTAL / "admin.html").read_text(encoding="utf-8")
    admin_script = (PORTAL / "admin.js").read_text(encoding="utf-8")
    client_script = (PORTAL / "supabase-client.js").read_text(encoding="utf-8")

    assert 'id="requestPasswordReset"' in admin_html
    assert 'id="passwordReset"' in admin_html
    assert 'minlength="12"' in admin_html
    assert "/auth/v1/recover" in client_script
    assert "/auth/v1/user" in client_script
    assert 'hash.get("type") !== "recovery"' in client_script
    assert 'client.select("admin_users"' in admin_script
    assert "password.length<12" in admin_script
    assert "await client.updatePassword(password)" in admin_script


def test_admin_library_lists_searches_and_auto_ids_subtitles() -> None:
    admin_html = (PORTAL / "admin.html").read_text(encoding="utf-8")
    admin_script = (PORTAL / "admin.js").read_text(encoding="utf-8")

    assert 'id="videoKey" type="hidden"' in admin_html
    assert 'id="librarySearch"' in admin_html
    assert 'id="library"' in admin_html
    assert 'id="newSubtitle"' in admin_html
    assert "crypto.randomUUID()" in admin_script
    assert "function renderLibrary()" in admin_script
    assert "function editTrack(track,video)" in admin_script
    assert "Edit / replace SRT" in admin_script
    assert "provider_video_key" in admin_script
