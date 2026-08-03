from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

EXTENSION_DIRECTORY = Path(__file__).resolve().parents[1] / "chrome_extension"


def test_chrome_extension_manifest_is_scoped_and_complete() -> None:
    manifest = json.loads((EXTENSION_DIRECTORY / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["manifest_version"] == 3
    assert manifest["permissions"] == ["activeTab", "downloads", "storage"]
    assert set(manifest["host_permissions"]) == {
        "https://*.netflix.com/*",
        "https://*.youtube.com/*",
    }
    assert "<all_urls>" not in manifest["host_permissions"]

    declared_files = {manifest["action"]["default_popup"]}
    for content_script in manifest["content_scripts"]:
        declared_files.update(content_script["js"])
    for relative_path in declared_files:
        assert (EXTENSION_DIRECTORY / relative_path).is_file()


def test_chrome_probe_does_not_request_network_or_capture_permissions() -> None:
    manifest_text = (EXTENSION_DIRECTORY / "manifest.json").read_text(encoding="utf-8")
    forbidden_permissions = {"debugger", "desktopCapture", "tabCapture", "webRequest"}

    assert forbidden_permissions.isdisjoint(json.loads(manifest_text)["permissions"])
    assert "http://" not in manifest_text


def test_chrome_probe_moves_panel_into_fullscreen_surface() -> None:
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    assert "document.fullscreenElement || document.documentElement" in content_script
    assert "placeOnActiveSurface(probeElements.host);" in content_script
    assert "placeOnActiveSurface(subtitleElements.host);" in content_script
    assert 'document.addEventListener("fullscreenchange", samplePlaybackState' in content_script


def test_chrome_extension_includes_local_srt_workflow() -> None:
    manifest = json.loads((EXTENSION_DIRECTORY / "manifest.json").read_text(encoding="utf-8"))
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    ordinary_script = next(
        item for item in manifest["content_scripts"] if "content.js" in item["js"]
    )
    assert ordinary_script["js"] == ["subtitle_core.js", "content.js"]
    assert 'type: "LOAD_SRT"' in popup_script
    assert 'message?.type === "LOAD_SRT"' in content_script
    assert "activeSubtitleText" in content_script
    assert "showDiagnostics: false" in content_script
    assert "innerHTML" not in content_script


def test_chrome_extension_captures_netflix_before_language_reactor() -> None:
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    native_position = content_script.index("NETFLIX_CAPTION_SELECTORS")
    fallback_position = content_script.index('textFromRenderedElements("#lln-subs-content")')
    assert native_position < fallback_position
    assert 'message?.type === "START_CAPTURE"' in content_script
    assert 'message?.type === "EXPORT_CAPTURE"' in content_script
    assert 'captureCommand("START_CAPTURE"' in popup_script
    assert 'captureCommand("EXPORT_CAPTURE"' in popup_script
    assert "saveAs: false" in popup_script
    assert "chrome.storage.local.set" in popup_script
    assert 'conflictAction: "uniquify"' in popup_script


def test_direct_track_probe_is_scoped_and_does_not_store_credentials() -> None:
    manifest = json.loads((EXTENSION_DIRECTORY / "manifest.json").read_text(encoding="utf-8"))
    probe_script = (EXTENSION_DIRECTORY / "netflix_track_probe.js").read_text(
        encoding="utf-8"
    )
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")

    main_world_script = next(
        item for item in manifest["content_scripts"] if "netflix_track_probe.js" in item["js"]
    )
    assert main_world_script["matches"] == ["https://*.netflix.com/*"]
    assert main_world_script["run_at"] == "document_start"
    assert main_world_script["world"] == "MAIN"
    assert "response.clone()" in probe_script
    assert "url.hostname" in probe_script and "url.pathname" in probe_script
    assert "document.cookie" not in probe_script
    assert "authorization" not in probe_script.casefold()
    assert "let active = true" in probe_script
    assert "queuedCandidates" in probe_script
    assert "replayQueuedCandidates" in probe_script
    assert 'setTrackProbeActive(true, { replayCandidates: true })' in content_script
    assert 'message?.type === "START_TRACK_PROBE"' in content_script
    assert 'captureCommand("START_TRACK_PROBE"' in popup_script
    assert '[data-uia="video-title"]' in content_script
    assert "candidate.episodeTitle" in content_script
    assert "candidate.language" in content_script


def test_subtitle_core_parses_and_offsets_srt_with_node() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")
    subprocess.run(
        [node, str(EXTENSION_DIRECTORY.parent / "tests" / "subtitle_core_smoke.js")],
        cwd=EXTENSION_DIRECTORY.parent,
        check=True,
        capture_output=True,
        text=True,
    )
