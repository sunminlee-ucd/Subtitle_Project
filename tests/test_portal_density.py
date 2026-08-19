from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_customer_and_admin_load_compact_density_stylesheet() -> None:
    customer = (PORTAL / "index.html").read_text(encoding="utf-8")
    admin = (PORTAL / "admin.html").read_text(encoding="utf-8")

    assert "/portal-assets/density.css" in customer
    assert "/portal-assets/density.css" in admin


def test_compact_density_reduces_desktop_scale_without_css_zoom() -> None:
    styles = (PORTAL / "density.css").read_text(encoding="utf-8")

    assert "font-size:13px" in styles
    assert "width:min(1320px" in styles
    assert "min-height:34px" in styles
    assert "zoom:" not in styles
    assert "transform:scale(" not in styles.replace(" ", "")


def test_mobile_inputs_remain_16px_to_avoid_browser_auto_zoom() -> None:
    styles = (PORTAL / "density.css").read_text(encoding="utf-8")

    assert "@media (max-width:760px)" in styles
    assert "input,select,textarea { font-size:16px; }" in styles


def test_customer_workspace_removes_large_hero_and_keeps_core_views_visible() -> None:
    customer = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert '<section class="hero-panel">' not in customer
    assert 'data-view="request">Request</button>' in customer
    assert 'data-view="requests">My requests</button>' in customer
    assert 'data-view="subtitles">My subtitles</button>' in customer
    assert 'data-view="report">Report issue</button>' in customer


def test_mobile_customer_navigation_and_episode_fields_fit_at_a_glance() -> None:
    styles = (PORTAL / "density.css").read_text(encoding="utf-8")

    assert ".customer-page .tabs" in styles
    assert "grid-template-columns:repeat(2,minmax(0,1fr))" in styles
    assert ".customer-page .compact-grid" in styles
    assert ".customer-page .field-help { display:none; }" in styles
    assert ".customer-page .submit-row span { display:none; }" in styles
