from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "customer_extension"


def test_customer_overlay_toggle_is_prominent_and_outside_tabs() -> None:
    html = (EXTENSION / "popup.html").read_text(encoding="utf-8")
    css = (EXTENSION / "overlay-toggle.css").read_text(encoding="utf-8")

    assert 'id="overlayPower"' in html
    assert 'id="overlayPowerStatus"' in html
    assert ">STOP OVERLAY</button>" in html
    assert html.index('class="overlay-power-card"') < html.index('class="tab-bar"')
    assert '<link rel="stylesheet" href="overlay-toggle.css">' in html
    assert 'position:sticky' in css
    assert 'background:var(--primary)' in css
    assert '.overlay-power-button.stopped' in css


def test_customer_overlay_toggle_uses_existing_visibility_setting() -> None:
    html = (EXTENSION / "popup.html").read_text(encoding="utf-8")
    script = (EXTENSION / "overlay-toggle.js").read_text(encoding="utf-8")
    popup = (EXTENSION / "popup.js").read_text(encoding="utf-8")

    assert '<script src="overlay-toggle.js"></script>' in html
    assert 'document.getElementById("visible")' in script
    assert 'visibility.checked = !visibility.checked' in script
    assert 'visibility.dispatchEvent(new Event("change", { bubbles: true }))' in script
    assert '"STOP OVERLAY" : "START OVERLAY"' in script
    assert '$("visible").addEventListener("change"' in popup
    assert 'updateSettings({ visible: $("visible").checked })' in popup


def test_customer_overlay_toggle_javascript_is_valid() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    subprocess.run(
        [node, "--check", str(EXTENSION / "overlay-toggle.js")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
