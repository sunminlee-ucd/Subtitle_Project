from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADMIN_EXTENSION = ROOT / "chrome_extension"


def test_admin_extension_uses_shared_dark_red_theme() -> None:
    html = (ADMIN_EXTENSION / "popup.html").read_text(encoding="utf-8")
    css = (ADMIN_EXTENSION / "popup.css").read_text(encoding="utf-8")

    assert '<link rel="stylesheet" href="popup.css" />' in html
    assert "--surface:#08090c" in css
    assert "--card:#14151a" in css
    assert "--primary:#e50914" in css
    assert "--primary-dark:#b20710" in css
    assert "background:linear-gradient(145deg,#111217 0%,#08090c 68%,#25090c 100%)" in css
    assert 'content:"ADMIN"' in css
    assert "accent-color:var(--primary)" in css


def test_admin_extension_keeps_admin_workflow_controls() -> None:
    html = (ADMIN_EXTENSION / "popup.html").read_text(encoding="utf-8")

    for control_id in (
        "downloadTrackCandidate",
        "startTrackProbe",
        "startCapture",
        "downloadCsv",
        "downloadSrt",
        "srtFile",
        "toggleOverlay",
        "playSelected",
        "offset",
        "fontSize",
        "bottom",
        "showDiagnostics",
    ):
        assert f'id="{control_id}"' in html
