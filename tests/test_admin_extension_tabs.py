import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "chrome_extension"


def test_admin_extension_groups_tools_into_four_tabs() -> None:
    html = (EXTENSION / "popup.html").read_text(encoding="utf-8")

    for name in ("extract", "subtitle", "study", "status"):
        assert f'data-admin-tab="{name}"' in html
        assert f'data-admin-panel="{name}"' in html

    assert "Download detected subtitle track" in html
    assert "Capture subtitles during playback" in html
    assert "Load translated SRT" in html
    assert "Display and timing settings" in html
    assert "Study subtitle clips" in html
    assert "Playback details" in html


def test_admin_tabs_are_accessible_and_use_existing_red_theme() -> None:
    script = (EXTENSION / "tabs.js").read_text(encoding="utf-8")
    css = (EXTENSION / "tabs.css").read_text(encoding="utf-8")

    assert 'button.setAttribute("aria-selected", String(active))' in script
    assert "ArrowLeft" in script and "ArrowRight" in script
    assert 'showTab("extract")' in script
    assert 'stylesheet.href = "tabs.css"' in script
    assert ".tab-button.active" in css
    assert "background:var(--primary)" in css


def test_all_existing_admin_popup_controls_remain_available() -> None:
    html = (EXTENSION / "popup.html").read_text(encoding="utf-8")

    for control_id in (
        "downloadTrackCandidate",
        "startTrackProbe",
        "startCapture",
        "downloadCsv",
        "downloadSrt",
        "srtFile",
        "toggleOverlay",
        "repeatCount",
        "playSelected",
        "offset",
        "fontSize",
        "bottom",
        "showDiagnostics",
        "expandAll",
        "collapseAll",
    ):
        assert f'id="{control_id}"' in html


@pytest.mark.parametrize("filename", ["tabs.js", "popup.js"])
def test_admin_extension_javascript_is_valid(filename: str) -> None:
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
