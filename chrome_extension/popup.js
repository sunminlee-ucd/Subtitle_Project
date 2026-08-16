"use strict";

const elements = {
  openNetflix: document.querySelector("#openNetflix"),
  openDisney: document.querySelector("#openDisney"),
  expandAll: document.querySelector("#expandAll"),
  collapseAll: document.querySelector("#collapseAll"),
  status: document.querySelector("#status"),
  fileStatus: document.querySelector("#fileStatus"),
  trackProbeStatus: document.querySelector("#trackProbeStatus"),
  trackCandidate: document.querySelector("#trackCandidate"),
  startTrackProbe: document.querySelector("#startTrackProbe"),
  stopTrackProbe: document.querySelector("#stopTrackProbe"),
  downloadTrackCandidate: document.querySelector("#downloadTrackCandidate"),
  clearTrackProbe: document.querySelector("#clearTrackProbe"),
  captureStatus: document.querySelector("#captureStatus"),
  captureRate: document.querySelector("#captureRate"),
  startCapture: document.querySelector("#startCapture"),
  stopCapture: document.querySelector("#stopCapture"),
  downloadCsv: document.querySelector("#downloadCsv"),
  downloadSrt: document.querySelector("#downloadSrt"),
  downloadFolder: document.querySelector("#downloadFolder"),
  downloadFolderStatus: document.querySelector("#downloadFolderStatus"),
  clearCapture: document.querySelector("#clearCapture"),
  srtFile: document.querySelector("#srtFile"),
  toggleOverlay: document.querySelector("#toggleOverlay"),
  cueSearch: document.querySelector("#cueSearch"),
  cueList: document.querySelector("#cueList"),
  repeatStatus: document.querySelector("#repeatStatus"),
  stopRepeat: document.querySelector("#stopRepeat"),
  repeatCount: document.querySelector("#repeatCount"),
  playSelected: document.querySelector("#playSelected"),
  clearSelected: document.querySelector("#clearSelected"),
  selectionStatus: document.querySelector("#selectionStatus"),
  offset: document.querySelector("#offset"),
  offsetValue: document.querySelector("#offsetValue"),
  fontSize: document.querySelector("#fontSize"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  bottom: document.querySelector("#bottom"),
  bottomValue: document.querySelector("#bottomValue"),
  showDiagnostics: document.querySelector("#showDiagnostics"),
  clear: document.querySelector("#clear"),
  time: document.querySelector("#time"),
  duration: document.querySelector("#duration"),
  playback: document.querySelector("#playback"),
  rate: document.querySelector("#rate"),
  fullscreen: document.querySelector("#fullscreen")
};

let settingsHydrated = false;
let transientStatusUntil = 0;
let trackCandidateSignature = "";
let subtitleCueSignature = "";
let loadedSubtitleCues = [];
let activeRepeatCueIndex = -1;
let currentSubtitleListId = "";
let selectedCueIndices = new Set();
let viewingMode = "watch";
let overlayVisible = true;
const DEFAULT_DOWNLOAD_FOLDER = "Subtitle_Project/captures";
const MAX_VISIBLE_CUES = 200;

function formatTime(totalSeconds) {
  const milliseconds = Math.max(0, Math.round(totalSeconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

function showFileStatus(message, isError = false, holdMilliseconds = 0) {
  elements.fileStatus.textContent = message;
  elements.fileStatus.classList.toggle("error", isError);
  transientStatusUntil = holdMilliseconds ? Date.now() + holdMilliseconds : 0;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active browser tab was found.");
  }
  return tab.id;
}

async function sendToActiveTab(message) {
  const tabId = await activeTabId();
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (_error) {
    throw new Error("Open or reload a Netflix, Disney+, or YouTube watch page first.");
  }
}

function currentSettings() {
  return {
    offsetSeconds: Number(elements.offset.value),
    fontSizePx: Number(elements.fontSize.value),
    bottomPercent: Number(elements.bottom.value),
    showSubtitles: overlayVisible,
    showDiagnostics: elements.showDiagnostics.checked
  };
}

function renderSettingValues() {
  const offset = Number(elements.offset.value);
  elements.offsetValue.textContent = `${offset >= 0 ? "+" : ""}${offset.toFixed(1)} s`;
  elements.fontSizeValue.textContent = `${elements.fontSize.value} px`;
  elements.bottomValue.textContent = `${elements.bottom.value}%`;
}

function renderCueList() {
  const query = elements.cueSearch.value.trim().toLocaleLowerCase();
  const selectedCues = loadedSubtitleCues.filter((cue) => selectedCueIndices.has(cue.index));
  const matching = query
    ? selectedCues.filter((cue) => cue.text.toLocaleLowerCase().includes(query))
    : selectedCues;
  const visible = matching.slice(0, MAX_VISIBLE_CUES);
  elements.cueList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = selectedCues.length
      ? "No saved subtitles match this search."
      : loadedSubtitleCues.length
        ? "Click an overlaid subtitle on the video to save it."
        : "Load an SRT file to begin.";
    elements.cueList.append(empty);
    return;
  }
  for (const cue of visible) {
    const item = document.createElement("div");
    item.className = "cue-item";
    if (cue.index === activeRepeatCueIndex) {
      item.classList.add("active");
    }
    const time = document.createElement("span");
    time.className = "cue-time";
    time.textContent = `#${cue.index + 1}  ${formatTime(cue.start)} → ${formatTime(cue.end)}`;
    const text = document.createElement("span");
    text.className = "cue-text";
    text.dir = "auto";
    text.textContent = cue.text.replace(/\s+/g, " ");
    item.append(time, text);
    elements.cueList.append(item);
  }
  if (matching.length > visible.length) {
    const more = document.createElement("div");
    more.className = "empty-state";
    more.textContent = `Showing ${visible.length} of ${matching.length}. Search to narrow the list.`;
    elements.cueList.append(more);
  }
}

function repeatCountValue() {
  const value = Math.round(Number(elements.repeatCount.value));
  return Math.min(20, Math.max(1, Number.isFinite(value) ? value : 5));
}

function renderSelectionStatus() {
  const count = selectedCueIndices.size;
  elements.selectionStatus.textContent = `${count} subtitle${count === 1 ? "" : "s"} selected`;
  elements.playSelected.disabled = count === 0 || loadedSubtitleCues.length === 0;
  elements.clearSelected.disabled = count === 0;
}

async function subtitleListId(filename, content) {
  const encoded = new TextEncoder().encode(`${filename}\u0000${content}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function syncSubtitleCueList(state) {
  const nextSignature = `${state?.subtitleListId || ""}:${state?.subtitleFilename || ""}:${state?.subtitleCueCount || 0}:${state?.studySelectionRevision || 0}`;
  if (nextSignature === subtitleCueSignature) {
    return;
  }
  subtitleCueSignature = nextSignature;
  if (!state?.subtitleCueCount) {
    loadedSubtitleCues = [];
    currentSubtitleListId = "";
    selectedCueIndices = new Set();
    activeRepeatCueIndex = -1;
    renderSelectionStatus();
    renderCueList();
    return;
  }
  try {
    const response = await sendToActiveTab({ type: "GET_SUBTITLE_CUES" });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not read the loaded subtitle list.");
    }
    loadedSubtitleCues = Array.isArray(response.cues) ? response.cues : [];
    currentSubtitleListId = String(response.subtitleListId || "");
    selectedCueIndices = new Set(
      (response.selectedCueIndices || []).map(Number).filter(Number.isInteger)
    );
    renderSelectionStatus();
    renderCueList();
  } catch (error) {
    subtitleCueSignature = "";
    showFileStatus(error.message, true, 4000);
  }
}

function renderRepeatStatus(state) {
  const repeat = state?.cueRepeatStatus;
  const nextActiveIndex = repeat?.active ? Number(repeat.cueIndex) : -1;
  if (nextActiveIndex !== activeRepeatCueIndex) {
    activeRepeatCueIndex = nextActiveIndex;
    renderCueList();
  }
  elements.stopRepeat.disabled = !repeat?.active;
  if (repeat?.active) {
    const playlist = state?.studyPlaylistStatus;
    const prefix = playlist?.active
      ? `Clip ${playlist.position + 1}/${playlist.total} · `
      : "";
    elements.repeatStatus.textContent = `${prefix}Repeating ${repeat.completed + 1}/${repeat.total} · ${formatTime(repeat.start)} → ${formatTime(repeat.end)}`;
  } else if (repeat?.playlistComplete) {
    elements.repeatStatus.textContent = "Selected clips completed.";
  } else if (repeat?.completed >= repeat?.total && repeat?.total) {
    elements.repeatStatus.textContent = `Completed ${repeat.total} repetitions · playback continues.`;
  } else if (repeat?.stopped) {
    elements.repeatStatus.textContent = "Repetition stopped.";
  } else {
    elements.repeatStatus.textContent = `Click subtitles on the video to save them.`;
  }
}

function render(state) {
  if (!state?.detected) {
    elements.status.textContent = "No visible video detected";
  } else {
    elements.status.textContent = state.playing ? "PLAYING" : state.seeking ? "SEEKING" : "PAUSED";
    elements.time.textContent = formatTime(state.currentTime);
    elements.duration.textContent = formatTime(state.duration);
    elements.playback.textContent = state.paused ? "Paused" : "Playing";
    elements.rate.textContent = `${state.playbackRate.toFixed(2)}x`;
    elements.fullscreen.textContent = state.fullscreen ? "Yes" : "No";
  }
  if (Date.now() >= transientStatusUntil) {
    showFileStatus(
      state?.subtitleCueCount
        ? `${state.subtitleFilename} - ${state.subtitleCueCount} cues loaded`
        : "No SRT loaded"
    );
  }
  if (!settingsHydrated && state?.subtitleSettings) {
    elements.offset.value = state.subtitleSettings.offsetSeconds;
    elements.fontSize.value = state.subtitleSettings.fontSizePx;
    elements.bottom.value = state.subtitleSettings.bottomPercent;
    overlayVisible = state.subtitleSettings.showSubtitles !== false;
    elements.showDiagnostics.checked = state.subtitleSettings.showDiagnostics;
    settingsHydrated = true;
    renderSettingValues();
  }
  if (state?.subtitleSettings) {
    overlayVisible = state.subtitleSettings.showSubtitles !== false;
  }
  elements.toggleOverlay.disabled = !state?.subtitleCueCount;
  elements.toggleOverlay.textContent = overlayVisible
    ? "Hide overlay subtitles"
    : "Show overlay subtitles";
  elements.toggleOverlay.setAttribute("aria-pressed", String(!overlayVisible));
  renderRepeatStatus(state);
  void syncSubtitleCueList(state);
  const sourceLabels = {
    netflix_native: "Netflix native",
    disney_native: "Disney+ native",
    browser_text_track: "Browser text track",
    language_reactor: "Language Reactor",
    none: "waiting for captions"
  };
  const capturedCount = Number(state?.capturedCueCount || 0);
  elements.captureStatus.textContent = state?.captureActive
    ? `CAPTURING - ${capturedCount} cues - ${sourceLabels[state.captureSource] || state.captureSource}`
    : `${capturedCount} cues captured${state?.captureSegmentCount > 1 ? ` / ${state.captureSegmentCount} segments` : ""}`;
  elements.startCapture.disabled = Boolean(state?.captureActive);
  elements.stopCapture.disabled = !state?.captureActive;
  elements.downloadCsv.disabled = capturedCount === 0;
  elements.downloadSrt.disabled = capturedCount === 0;
  elements.clearCapture.disabled = capturedCount === 0 && !state?.captureActive;

  const candidates = Array.isArray(state?.trackCandidates) ? state.trackCandidates : [];
  elements.trackProbeStatus.textContent = state?.trackProbeActive
    ? `LISTENING - ${candidates.length} candidate(s)`
    : `${candidates.length} candidate(s) detected`;
  elements.startTrackProbe.disabled = false;
  elements.stopTrackProbe.disabled = !state?.trackProbeActive;
  elements.downloadTrackCandidate.disabled = candidates.length === 0;
  elements.clearTrackProbe.disabled = candidates.length === 0 && !state?.trackProbeActive;

  const nextSignature = candidates
    .map((candidate) => `${candidate.fingerprint}:${candidate.size}`)
    .join("|");
  if (nextSignature !== trackCandidateSignature) {
    const previousSelection = elements.trackCandidate.value;
    elements.trackCandidate.replaceChildren();
    if (!candidates.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No candidate detected";
      elements.trackCandidate.append(option);
    } else {
      candidates.forEach((candidate, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        const kilobytes = Math.max(1, Math.round(candidate.size / 1024));
        const videoLabel = [candidate.videoTitle, candidate.episodeTitle]
          .filter(Boolean)
          .join(" - ");
        option.textContent = `${index + 1}. ${videoLabel || "OTT video"} / ${candidate.language || "language unknown"} / ${candidate.format} / ${candidate.cueEstimate} cues / ${kilobytes} KB / ${candidate.transport}`;
        elements.trackCandidate.append(option);
      });
      if (
        [...elements.trackCandidate.options].some(
          (option) => option.value === previousSelection
        )
      ) {
        elements.trackCandidate.value = previousSelection;
      }
    }
    trackCandidateSignature = nextSignature;
  }
}

async function refresh() {
  try {
    render(await sendToActiveTab({ type: "GET_PLAYBACK_STATE" }));
  } catch (error) {
    elements.status.textContent = error.message;
  }
}

async function applySettings() {
  renderSettingValues();
  try {
    const response = await sendToActiveTab({
      type: "SET_SUBTITLE_SETTINGS",
      settings: currentSettings()
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not update subtitle settings.");
    }
    render(response);
  } catch (error) {
    showFileStatus(error.message, true, 3000);
  }
}

function normalizedDownloadFolder(rawFolder) {
  return String(rawFolder || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim().replace(/[<>:"|?*\x00-\x1F]/g, "_"))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

async function loadDownloadFolder() {
  const stored = await chrome.storage.local.get({ downloadFolder: DEFAULT_DOWNLOAD_FOLDER });
  elements.downloadFolder.value = normalizedDownloadFolder(stored.downloadFolder);
}

async function saveDownloadFolder() {
  const folder = normalizedDownloadFolder(elements.downloadFolder.value);
  elements.downloadFolder.value = folder;
  await chrome.storage.local.set({ downloadFolder: folder });
  elements.downloadFolderStatus.textContent = folder
    ? `Auto-save: Downloads/${folder}`
    : "Auto-save: Downloads root";
}

function renderViewingMode(mode) {
  viewingMode = mode === "study" ? "study" : "watch";
  document.body.dataset.viewingMode = viewingMode;
  for (const button of document.querySelectorAll("button[data-viewing-mode]")) {
    button.classList.toggle("active", button.dataset.viewingMode === viewingMode);
  }
}

async function setViewingMode(mode, { showErrors = true } = {}) {
  renderViewingMode(mode);
  await chrome.storage.local.set({ viewingMode });
  try {
    const response = await sendToActiveTab({ type: "SET_VIEWING_MODE", mode: viewingMode });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not change the viewing mode.");
    }
    render(response);
  } catch (error) {
    if (showErrors) {
      showFileStatus(error.message, true, 4000);
    }
  }
}

async function loadStudyPreferences() {
  const stored = await chrome.storage.local.get({
    viewingMode: "watch",
    studyRepeatCount: 5
  });
  elements.repeatCount.value = String(
    Math.min(20, Math.max(1, Number(stored.studyRepeatCount) || 5))
  );
  await setViewingMode(stored.viewingMode, { showErrors: false });
  renderSelectionStatus();
}

async function downloadText(filename, content, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  try {
    const folder = normalizedDownloadFolder(elements.downloadFolder.value);
    const relativePath = folder ? `${folder}/${filename}` : filename;
    await chrome.downloads.download({
      url,
      filename: relativePath,
      saveAs: false,
      conflictAction: "uniquify"
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function captureCommand(type, extra = {}) {
  const response = await sendToActiveTab({ type, ...extra });
  if (!response?.ok) {
    throw new Error(response?.error || "The capture command failed.");
  }
  render(response);
  return response;
}

async function navigateActiveTab(url) {
  const tabId = await activeTabId();
  await chrome.tabs.update(tabId, { url });
}

elements.openNetflix.addEventListener("click", () => {
  navigateActiveTab("https://www.netflix.com/browse").catch((error) => {
    showFileStatus(error.message, true, 4000);
  });
});

elements.openDisney.addEventListener("click", () => {
  navigateActiveTab("https://www.disneyplus.com/").catch((error) => {
    showFileStatus(error.message, true, 4000);
  });
});

for (const button of document.querySelectorAll("button[data-viewing-mode]")) {
  button.addEventListener("click", () => {
    setViewingMode(button.dataset.viewingMode).catch((error) => {
      showFileStatus(error.message, true, 4000);
    });
  });
}

elements.srtFile.addEventListener("change", async () => {
  const [file] = elements.srtFile.files;
  if (!file) {
    return;
  }
  showFileStatus(`Loading ${file.name}...`);
  try {
    const content = await file.text();
    const response = await sendToActiveTab({
      type: "LOAD_SRT",
      filename: file.name,
      content,
      subtitleListId: await subtitleListId(file.name, content)
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not parse the selected SRT file.");
    }
    showFileStatus(`${file.name} - ${response.subtitleCueCount} cues loaded`, false, 2500);
    render(response);
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  } finally {
    elements.srtFile.value = "";
  }
});

elements.toggleOverlay.addEventListener("click", async () => {
  overlayVisible = !overlayVisible;
  await applySettings();
});

elements.cueSearch.addEventListener("input", renderCueList);
elements.repeatCount.addEventListener("change", async () => {
  elements.repeatCount.value = String(repeatCountValue());
  await chrome.storage.local.set({ studyRepeatCount: repeatCountValue() });
  elements.repeatStatus.textContent = "Click subtitles on the video to save them.";
});

elements.playSelected.addEventListener("click", async () => {
  try {
    await captureCommand("PLAY_STUDY_PLAYLIST", {
      cueIndices: [...selectedCueIndices],
      repeatCount: repeatCountValue()
    });
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

elements.clearSelected.addEventListener("click", async () => {
  try {
    await captureCommand("SET_STUDY_SELECTIONS", { cueIndices: [] });
  } catch (error) {
    showFileStatus(`Could not clear the saved study list: ${error.message}`, true, 4000);
  }
});

elements.expandAll.addEventListener("click", () => {
  for (const section of document.querySelectorAll("details.section")) {
    section.open = true;
  }
});

elements.collapseAll.addEventListener("click", () => {
  for (const section of document.querySelectorAll("details.section")) {
    section.open = false;
  }
});

elements.stopRepeat.addEventListener("click", async () => {
  try {
    await captureCommand("STOP_SUBTITLE_REPEAT");
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

for (const slider of [elements.offset, elements.fontSize, elements.bottom]) {
  slider.addEventListener("input", applySettings);
}
elements.showDiagnostics.addEventListener("change", applySettings);
elements.startTrackProbe.addEventListener("click", async () => {
  try {
    await captureCommand("START_TRACK_PROBE");
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

elements.stopTrackProbe.addEventListener("click", async () => {
  try {
    await captureCommand("STOP_TRACK_PROBE");
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

elements.clearTrackProbe.addEventListener("click", async () => {
  try {
    await captureCommand("CLEAR_TRACK_PROBE");
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

elements.downloadTrackCandidate.addEventListener("click", async () => {
  try {
    const response = await captureCommand("EXPORT_TRACK_CANDIDATE", {
      index: Number(elements.trackCandidate.value)
    });
    await downloadText(response.filename, response.content, response.mimeType);
    showFileStatus(`${response.filename} downloaded. Open it in SubtitleProcessor.`, false, 7000);
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

elements.downloadFolder.addEventListener("change", async () => {
  try {
    await saveDownloadFolder();
  } catch (_error) {
    elements.downloadFolderStatus.textContent = "Could not save this folder setting";
  }
});

elements.startCapture.addEventListener("click", async () => {
  try {
    await captureCommand("START_CAPTURE", {
      playbackRate: Number(elements.captureRate.value)
    });
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

elements.stopCapture.addEventListener("click", async () => {
  try {
    await captureCommand("STOP_CAPTURE");
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

elements.clearCapture.addEventListener("click", async () => {
  try {
    await captureCommand("CLEAR_CAPTURE");
  } catch (error) {
    showFileStatus(error.message, true, 5000);
  }
});

for (const [button, format] of [
  [elements.downloadCsv, "csv"],
  [elements.downloadSrt, "srt"]
]) {
  button.addEventListener("click", async () => {
    try {
      const response = await captureCommand("EXPORT_CAPTURE", { format });
      await downloadText(response.filename, response.content, response.mimeType);
    } catch (error) {
      showFileStatus(error.message, true, 5000);
    }
  });
}

for (const button of document.querySelectorAll("[data-offset-delta]")) {
  button.addEventListener("click", () => {
    const nextValue = Number(elements.offset.value) + Number(button.dataset.offsetDelta);
    elements.offset.value = String(Math.min(30, Math.max(-30, nextValue)));
    applySettings();
  });
}

elements.clear.addEventListener("click", async () => {
  try {
    const response = await sendToActiveTab({ type: "CLEAR_SUBTITLES" });
    if (!response?.ok) {
      throw new Error(response?.error || "Could not remove subtitles.");
    }
    showFileStatus("Subtitles removed", false, 2000);
    render(response);
  } catch (error) {
    showFileStatus(error.message, true, 4000);
  }
});

async function initializePopup() {
  renderSettingValues();
  try {
    await loadDownloadFolder();
    await saveDownloadFolder();
  } catch (_error) {
    elements.downloadFolderStatus.textContent = "Using Chrome Downloads folder";
  }
  try {
    await loadStudyPreferences();
  } catch (_error) {
    renderViewingMode("watch");
    renderSelectionStatus();
  }
  await refresh();
  setInterval(refresh, 500);
}

initializePopup();
