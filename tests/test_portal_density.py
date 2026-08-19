from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_customer_and_admin_load_compact_density_stylesheet() -> None:
    customer = (PORTAL / "index.html").read_text(encoding="utf-8")
    admin = (PORTAL / "admin.html").read_text(encoding="utf-8")

    asset = '/portal-assets/density.css?v=20260819-1'
    assert asset in customer
    assert asset in admin


def test_compact_density_reduces_desktop_scale_without_css_zoom() -> None:
    styles = (PORTAL / "density.css").read_text(encoding="utf-8")

    assert "font-size:13px" in styles
    assert "width:min(1320px" in styles
    assert "min-height:34px" in styles
    assert "min-height:178px" in styles
    assert "zoom:" not in styles
    assert "transform:scale(" not in styles.replace(" ", "")


def test_mobile_inputs_remain_16px_to_avoid_browser_auto_zoom() -> None:
    styles = (PORTAL / "density.css").read_text(encoding="utf-8")

    assert "@media (max-width:760px)" in styles
    assert "input,select,textarea { font-size:16px; }" in styles
