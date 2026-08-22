from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CUSTOMER = ROOT / "customer_extension"
ADMIN = ROOT / "chrome_extension"


def test_customer_tabs_are_visually_connected_to_the_active_panel() -> None:
    loader_css = (CUSTOMER / "overlay-toggle.css").read_text(encoding="utf-8")
    css = (CUSTOMER / "tab-visual.css").read_text(encoding="utf-8")

    assert '@import url("tab-visual.css")' in loader_css
    assert "border-radius:10px 10px 0 0" in css
    assert "margin:0 0 -1px" in css
    assert "box-shadow:inset 0 3px 0 var(--primary)" in css
    assert ".tab-button.active::after" in css
    assert "border-top:0" in css
    assert "border-radius:0 0 14px 14px" in css


def test_admin_tabs_are_visually_connected_to_the_active_panel() -> None:
    html = (ADMIN / "popup.html").read_text(encoding="utf-8")
    css = (ADMIN / "tabs.css").read_text(encoding="utf-8")

    assert '<link rel="stylesheet" href="tabs.css" />' in html
    assert "main{gap:0}" in css
    assert ".app-header{margin-bottom:10px}" in css
    assert "border-radius:10px 10px 0 0" in css
    assert "box-shadow:inset 0 3px 0 var(--primary)" in css
    assert ".tab-button.active::after" in css
    assert "border-top:0" in css
    assert "border-radius:0 0 14px 14px" in css
