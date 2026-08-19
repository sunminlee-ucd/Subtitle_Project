from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_admin_accept_decline_and_auto_completion_flow() -> None:
    source = (PORTAL / "admin.js").read_text(encoding="utf-8")
    styles = (PORTAL / "workflow.css").read_text(encoding="utf-8")

    assert 'accept.textContent = "Accept"' in source
    assert 'accept.className = "approve"' in source
    assert 'decline.textContent = "Decline"' in source
    assert 'decline.className = "decline"' in source
    assert 'setRequestStatus(row, "reviewing")' in source
    assert '{status:"completed"}' in source
    assert 'client.upsert(\n          "subtitle_grants"' in source
    assert "button.approve" in styles
    assert "button.decline" in styles


def test_customer_sees_request_status_and_authorized_library() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")
    source = (PORTAL / "customer.js").read_text(encoding="utf-8")

    assert 'data-view="requests"' in html
    assert 'data-view="subtitles"' in html
    assert 'id="requestsHistory"' in html
    assert 'id="subtitles"' in html
    assert 'status === "reviewing"' in source
    assert 'label: "Pending"' in source
    assert 'status === "completed"' in source
    assert 'label: "Complete"' in source
    assert 'client.select(\n        "subtitle_tracks"' in source
    assert "Available in your authorized Android app and Chrome extension" in source


def test_portal_javascript_syntax() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    for filename in ("customer.js", "admin.js"):
        subprocess.run(
            [node, "--check", str(PORTAL / filename)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
