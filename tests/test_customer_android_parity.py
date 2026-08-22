from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "customer_extension"


def test_customer_extension_keeps_admin_srt_features_out() -> None:
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    source = "\n".join(
        path.read_text(encoding="utf-8").lower()
        for path in EXTENSION.glob("*")
        if path.suffix in {".js", ".html"}
    )

    assert "downloads" not in manifest.get("permissions", [])
    assert "webRequest" not in manifest.get("permissions", [])
    assert "chrome.downloads" not in source
    assert 'accept=".srt"' not in source
    assert "createobjecturl" not in source
    assert "capturedrow" not in source


def test_customer_extension_has_android_style_controls() -> None:
    html = (EXTENSION / "popup.html").read_text(encoding="utf-8")
    popup = (EXTENSION / "popup.js").read_text(encoding="utf-8")
    content = (EXTENSION / "content.js").read_text(encoding="utf-8")

    for control_id in (
        "seekBack",
        "playPause",
        "seekForward",
        "speed",
        "syncEarlier",
        "syncLater",
        "fontSmaller",
        "fontLarger",
        "moveDown",
        "moveUp",
        "resetPosition",
        "repeatCurrent",
        "playSelections",
        "stopStudy",
        "clearStudy",
        "savedList",
        "multiPrimary",
        "multiSecondary",
    ):
        assert f'id="{control_id}"' in html

    assert 'type: "CONTROL_PLAYBACK"' in popup
    assert 'studyAction("REPEAT_CURRENT")' in popup
    assert 'studyAction("PLAY_STUDY_SELECTIONS")' in popup
    assert 'type: "GET_STUDY_SELECTIONS"' in popup
    assert 'slot: "secondary"' in popup

    assert 'case "CONTROL_PLAYBACK"' in content
    assert 'case "REPEAT_CURRENT"' in content
    assert 'case "PLAY_STUDY_SELECTIONS"' in content
    assert 'case "STOP_STUDY_PLAYBACK"' in content
    assert 'case "CLEAR_STUDY_SELECTIONS"' in content
    assert "secondaryCues" in content
    assert "secondaryTrackId" in content


def test_customer_extension_uses_tabs_and_android_dark_red_theme() -> None:
    html = (EXTENSION / "popup.html").read_text(encoding="utf-8")
    css = (EXTENSION / "popup.css").read_text(encoding="utf-8").lower()
    tabs = (EXTENSION / "tabs.js").read_text(encoding="utf-8")

    for tab in ("library", "controls", "study", "support"):
        assert f'data-customer-tab="{tab}"' in html
        assert f'data-tab-panel="{tab}"' in html

    assert '<script src="tabs.js"></script>' in html
    assert 'showTab("library")' in tabs
    assert 'panel.hidden = !active' in tabs
    assert 'button.setAttribute("aria-selected"' in tabs

    assert "--surface:#08090c" in css
    assert "--card:#14151a" in css
    assert "--primary:#e50914" in css
    assert "--primary-dark:#b20710" in css
    assert "--text:#f7f7f8" in css
    assert ".tab-button.active" in css
    assert "background:var(--primary)" in css


def test_customer_extension_still_loads_only_authorized_tracks() -> None:
    popup = (EXTENSION / "popup.js").read_text(encoding="utf-8")
    background = (EXTENSION / "background.js").read_text(encoding="utf-8")

    assert 'client.select(\n        "subtitle_tracks"' in popup
    assert 'downloadStorageText("subtitle-files"' in popup
    assert 'downloadStorageText("subtitle-files"' in background
    assert "sb_secret_" not in popup.lower()
    assert "service_role" not in popup.lower()
