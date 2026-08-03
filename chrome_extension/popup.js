"use strict";

const elements = {
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
const DEFAULT_DOWNLOAD_FOLDER = "Subtitle_Project/captures";

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
    throw new Error("Open or reload a Netflix or YouTube watch page first.");
  }
}

function currentSettings() {
  return {
    offsetSeconds: Number(elements.offset.value),
    fontSizePx: Number(elements.fontSize.value),
    bottomPercent: Number(elements.bottom.value),
    showDiagnostics: elements.showDiagnostics.checked
  };
}

function renderSettingValues() {
  const offset = Number(elements.offset.value);
  elements.offsetValue.textContent = `${offset >= 0 ? "+" : ""}${offset.toFixed(1)} s`;
  elements.fontSizeValue.textContent = `${elements.fontSize.value} px`;
  elements.bottomValue.textContent = `${elements.bottom.value}%`;
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
    elements.showDiagnostics.checked = state.subtitleSettings.showDiagnostics;
    settingsHydrated = true;
    renderSettingValues();
  }
  const sourceLabels = {
    netflix_native: "Netflix native",
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
        option.textContent = `${index + 1}. ${videoLabel || "Netflix video"} / ${candidate.format} / ${candidate.cueEstimate} cues / ${kilobytes} KB / ${candidate.transport}`;
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

elements.srtFile.addEventListener("change", async () => {
  const [file] = elements.srtFile.files;
  if (!file) {
    return;
  }
  showFileStatus(`Loading ${file.name}...`);
  try {
    const response = await sendToActiveTab({
      type: "LOAD_SRT",
      filename: file.name,
      content: await file.text()
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

renderSettingValues();
loadDownloadFolder().then(saveDownloadFolder).catch(() => {
  elements.downloadFolderStatus.textContent = "Using Chrome Downloads folder";
});
refresh();
setInterval(refresh, 500);
