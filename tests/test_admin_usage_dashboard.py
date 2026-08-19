from pathlib import Path

from app import cloud_usage

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_admin_usage_tab_is_wired() -> None:
    html = (PORTAL / "admin.html").read_text(encoding="utf-8")
    ui = (PORTAL / "admin-ui.js").read_text(encoding="utf-8")
    usage = (PORTAL / "admin-usage.js").read_text(encoding="utf-8")
    client = (PORTAL / "supabase-client.js").read_text(encoding="utf-8")

    assert 'data-admin-view="usage"' in html
    assert 'id="adminUsageView"' in html
    assert 'id="supabaseUsage"' in html
    assert 'id="cloudRunUsage"' in html
    assert '"usage"' in ui
    assert 'client.rpc("admin_usage_snapshot")' in usage
    assert 'fetch("/api/usage/cloud-run"' in usage
    assert "async rpc(functionName" in client


def test_usage_is_split_into_supabase_and_cloud_run_tabs() -> None:
    html = (PORTAL / "admin.html").read_text(encoding="utf-8")
    usage = (PORTAL / "admin-usage.js").read_text(encoding="utf-8")
    styles = (PORTAL / "admin-ui.css").read_text(encoding="utf-8")

    assert 'data-usage-view="supabase"' in html
    assert 'data-usage-view="cloud-run"' in html
    assert 'data-usage-panel="supabase"' in html
    assert 'data-usage-panel="cloud-run"' in html
    assert 'id="usageSupabasePanel"' in html
    assert 'id="usageCloudRunPanel"' in html
    assert 'id="usageCloudRunPanel" class="usage-panel" data-usage-panel="cloud-run" hidden' in html
    assert 'currentUsageView = "supabase"' in usage
    assert 'panel.hidden = panel.dataset.usagePanel !== selected' in usage
    assert 'button.classList.toggle("active"' in usage
    assert ".usage-panel[hidden]" in styles
    assert ".usage-tabs" in styles


def test_usage_only_loads_the_selected_service() -> None:
    usage = (PORTAL / "admin-usage.js").read_text(encoding="utf-8")

    assert "Promise.allSettled" not in usage
    assert 'if (currentUsageView === "cloud-run")' in usage
    assert "await loadCloudRun()" in usage
    assert "await loadSupabase()" in usage
    assert "const loadedViews = new Set()" in usage
    assert "loadedViews.has(currentUsageView)" in usage


def test_usage_limits_and_warning_thresholds_are_present() -> None:
    usage = (PORTAL / "admin-usage.js").read_text(encoding="utf-8")

    assert "500_000_000" in usage
    assert "1_000_000_000" in usage
    assert "50_000" in usage
    assert "2_500" in usage
    assert "0.5 * GIB" in usage
    assert "percent >= 95" in usage
    assert "percent >= 85" in usage
    assert "percent >= 70" in usage


def test_cloud_run_resource_parsing() -> None:
    assert cloud_usage._cpu_count("1") == 1.0
    assert cloud_usage._cpu_count("500m") == 0.5
    assert cloud_usage._memory_gib("512Mi") == 0.5
    assert cloud_usage._memory_gib("2Gi") == 2.0


def test_cloud_run_usage_degrades_when_metadata_is_unavailable(monkeypatch) -> None:
    def unavailable(_path: str) -> str:
        raise OSError("metadata unavailable")

    monkeypatch.setattr(cloud_usage, "_metadata", unavailable)
    result = cloud_usage.cloud_run_usage()

    assert result["available"] is False
    assert result["limits"]["requests"] == 2_000_000
    assert result["limits"]["vcpu_seconds"] == 180_000
    assert result["limits"]["gib_seconds"] == 360_000
    assert "Cloud Monitoring Viewer" in result["message"]


def test_usage_migration_is_documented() -> None:
    migration = (ROOT / "supabase" / "admin_usage_migration.sql").read_text(encoding="utf-8")

    assert "create or replace function public.admin_usage_snapshot()" in migration
    assert "security invoker" in migration
    assert "revoke execute on function public.rls_auto_enable()" in migration
