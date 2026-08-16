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
        "https://*.disneyplus.com/*",
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
    assert "activeSubtitleCueIndices" in content_script
    assert "showDiagnostics: false" in content_script
    assert "showSubtitles: true" in content_script
    assert "innerHTML" not in content_script


def test_chrome_extension_captures_native_ott_before_language_reactor() -> None:
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    native_position = content_script.index("NETFLIX_CAPTION_SELECTORS")
    fallback_position = content_script.index('textFromRenderedElements("#lln-subs-content")')
    assert native_position < fallback_position
    assert "DISNEY_CAPTION_SELECTORS" in content_script
    assert 'source: "disney_native"' in content_script
    assert "readActiveTextTrackCaption" in content_script
    assert 'message?.type === "START_CAPTURE"' in content_script
    assert 'message?.type === "EXPORT_CAPTURE"' in content_script
    assert 'captureCommand("START_CAPTURE"' in popup_script
    assert 'captureCommand("EXPORT_CAPTURE"' in popup_script
    assert "saveAs: false" in popup_script
    assert "chrome.storage.local.set" in popup_script
    assert 'conflictAction: "uniquify"' in popup_script


def test_direct_track_probe_is_scoped_and_does_not_store_credentials() -> None:
    manifest = json.loads((EXTENSION_DIRECTORY / "manifest.json").read_text(encoding="utf-8"))
    probe_script = (EXTENSION_DIRECTORY / "ott_track_probe.js").read_text(
        encoding="utf-8"
    )
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")

    main_world_script = next(
        item for item in manifest["content_scripts"] if "ott_track_probe.js" in item["js"]
    )
    assert set(main_world_script["matches"]) == {
        "https://*.netflix.com/*",
        "https://*.disneyplus.com/*",
    }
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
    assert '[data-testid="title"]' in content_script
    assert "candidate.episodeTitle" in content_script
    assert "candidate.language" in content_script


def test_track_candidates_follow_only_the_current_video() -> None:
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")
    probe_script = (EXTENSION_DIRECTORY / "ott_track_probe.js").read_text(
        encoding="utf-8"
    )

    assert "let activeVideoKey = currentVideoKey()" in content_script
    assert "if (videoKey !== activeVideoKey)" in content_script
    assert "trackCandidates = []" in content_script
    assert "latestVideoMetadata = { title: \"\", episode: \"\" }" in content_script
    assert "clearQueuedCandidates()" in probe_script
    assert "const requestVideoKey = activeVideoKey" in probe_script


def test_selected_text_track_is_detected_at_start_or_mid_playback() -> None:
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    assert "scanSelectedTextTrack(video)" in content_script
    assert 'track.mode === "showing"' in content_script
    assert "Array.from(track.cues || [])" in content_script
    assert "textTrackRowsByKey" in content_script
    assert 'transport: "text-track"' in content_script
    assert 'srt: "srt"' in content_script


def test_popup_has_netflix_and_disney_navigation() -> None:
    popup_html = (EXTENSION_DIRECTORY / "popup.html").read_text(encoding="utf-8")
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")

    assert 'id="openNetflix"' in popup_html
    assert 'id="openDisney"' in popup_html
    assert 'navigateActiveTab("https://www.netflix.com/browse")' in popup_script
    assert 'navigateActiveTab("https://www.disneyplus.com/")' in popup_script
    assert "chrome.tabs.update" in popup_script


def test_loaded_srt_cue_repeat_defaults_to_five_and_is_configurable() -> None:
    popup_html = (EXTENSION_DIRECTORY / "popup.html").read_text(encoding="utf-8")
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    assert 'id="cueList"' in popup_html
    assert 'id="stopRepeat"' in popup_html
    assert 'id="repeatCount"' in popup_html
    assert 'value="5"' in popup_html
    assert 'type: "GET_SUBTITLE_CUES"' in popup_script
    assert "repeatCount: repeatCountValue()" in popup_script
    assert 'captureCommand("PLAY_STUDY_PLAYLIST"' in popup_script
    assert "cueRepeat.completed += 1" in content_script
    assert "cueRepeat.completed >= cueRepeat.total" in content_script
    assert "core.cuePlaybackBounds(cue, settings.offsetSeconds)" in content_script
    assert "continuedPlayback: true" in content_script


def test_watch_and_study_modes_include_saved_clip_playlist() -> None:
    popup_html = (EXTENSION_DIRECTORY / "popup.html").read_text(encoding="utf-8")
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    assert 'data-viewing-mode="watch"' in popup_html
    assert 'data-viewing-mode="study"' in popup_html
    assert 'id="playSelected"' in popup_html
    assert 'id="clearSelected"' in popup_html
    assert "studySelectionsBySubtitle" in content_script
    assert "crypto.subtle.digest" in popup_script
    assert 'captureCommand("PLAY_STUDY_PLAYLIST"' in popup_script
    assert 'message?.type === "PLAY_STUDY_PLAYLIST"' in content_script
    assert "startStudyPlaylist" in content_script
    assert "playlistComplete: true" in content_script


def test_study_mode_selects_the_overlaid_subtitle_on_video() -> None:
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    assert "toggleRenderedStudyCues" in content_script
    assert 'subtitle.addEventListener("click"' in content_script
    assert 'subtitle.classList.toggle("selected"' in content_script
    assert 'viewingMode === "study"' in content_script
    assert "activeSubtitleCueIndices" in content_script
    assert "saveStudySelection" in content_script
    assert 'message?.type === "SET_STUDY_SELECTIONS"' in content_script
    assert "[data-select-cue-index]" not in popup_script


def test_all_panel_sections_can_be_opened_or_closed_together() -> None:
    popup_html = (EXTENSION_DIRECTORY / "popup.html").read_text(encoding="utf-8")
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")

    assert 'id="expandAll"' in popup_html
    assert 'id="collapseAll"' in popup_html
    assert 'document.querySelectorAll("details.section")' in popup_script
    assert "section.open = true" in popup_script
    assert "section.open = false" in popup_script
    assert '<summary>3. Load translated SRT</summary>' in popup_html
    assert '<section class="section">' not in popup_html


def test_overlay_subtitles_can_be_shown_or_hidden() -> None:
    popup_html = (EXTENSION_DIRECTORY / "popup.html").read_text(encoding="utf-8")
    popup_script = (EXTENSION_DIRECTORY / "popup.js").read_text(encoding="utf-8")
    content_script = (EXTENSION_DIRECTORY / "content.js").read_text(encoding="utf-8")

    assert 'id="toggleOverlay"' in popup_html
    assert 'elements.toggleOverlay.addEventListener("click"' in popup_script
    assert "showSubtitles: overlayVisible" in popup_script
    assert "if (!settings.showSubtitles)" in content_script


def test_popup_groups_controls_into_clear_sections() -> None:
    popup_html = (EXTENSION_DIRECTORY / "popup.html").read_text(encoding="utf-8")

    assert "1. Download detected subtitle track" in popup_html
    assert "2. Capture subtitles during playback" in popup_html
    assert "3. Load translated SRT" in popup_html
    assert "Display and timing settings" in popup_html
    assert "Playback details" in popup_html


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
