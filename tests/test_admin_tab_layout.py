from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_admin_workspace_is_split_into_focused_tabs() -> None:
    html = (PORTAL / "admin.html").read_text(encoding="utf-8")

    for view in ["requests", "library", "access", "reports", "history", "usage"]:
        assert f'data-admin-view="{view}"' in html
    assert 'id="adminRequestsView"' in html
    assert 'id="adminLibraryView"' in html
    assert 'id="adminAccessView"' in html
    assert 'id="adminReportsView"' in html
    assert 'id="adminHistoryView"' in html
    assert 'id="adminUsageView"' in html
    assert "/portal-assets/admin-ui.css" in html
    assert "/portal-assets/admin-ui.js" in html


def test_completed_and_declined_requests_leave_active_queue_but_keep_history() -> None:
    script = (PORTAL / "admin-ui.js").read_text(encoding="utf-8")

    assert 'status === "Declined" || status === "Complete"' in script
    assert "item.hidden = archived" in script
    assert 'document.getElementById("requestHistory")' in script
    assert 'archivedItem.querySelector(".request-actions")?.remove()' in script


def test_prepare_access_switches_to_library_tab() -> None:
    script = (PORTAL / "admin-ui.js").read_text(encoding="utf-8")

    assert 'button.textContent.trim() === "Prepare access"' in script
    assert 'showAdminView("library")' in script


def test_admin_tabs_are_compact_on_mobile() -> None:
    styles = (PORTAL / "admin-ui.css").read_text(encoding="utf-8")

    assert "grid-template-columns:repeat(6" in styles
    assert "@media (max-width:760px)" in styles
    assert "grid-template-columns:repeat(2" in styles
