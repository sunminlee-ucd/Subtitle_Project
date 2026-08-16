(() => {
  "use strict";

  if (window.top !== window || window.__subtitleSyncLoaded) {
    return;
  }
  window.__subtitleSyncLoaded = true;

  const UPDATE_INTERVAL_MS = 100;
  const TRACK_PROBE_CONTROL_SOURCE = "subtitle-sync-extension-control";
  const TRACK_PROBE_EVENT_SOURCE = "subtitle-sync-page-probe";
  const STUDY_SELECTIONS_KEY = "studySelectionsBySubtitle";
  const NETFLIX_CAPTION_SELECTORS = [
    '[data-uia="player-subtitle-text"]',
    ".player-timedtext-text-container"
  ];
  const DISNEY_CAPTION_SELECTORS = [
    '[data-testid="subtitle-overlay"]',
    '[data-testid="subtitle-renderer"]',
    ".dss-subtitle-renderer-cue-window",
    ".dss-subtitle-renderer-line"
  ];
  const MEDIA_EVENTS = [
    "play",
    "pause",
    "seeking",
    "seeked",
    "ratechange",
    "loadedmetadata",
    "durationchange",
    "ended"
  ];
  const observedVideos = new WeakSet();
  const core = globalThis.SubtitleSyncCore;
  let latestState = noVideoState();
  let probeElements = null;
  let subtitleElements = null;
  let subtitleCues = [];
  let subtitleFilename = "";
  let subtitleListId = "";
  let settings = {
    offsetSeconds: 0,
    fontSizePx: 38,
    bottomPercent: 10,
    showSubtitles: true,
    showDiagnostics: false
  };
  let capture = emptyCaptureState();
  let trackProbeActive = true;
  let trackCandidates = [];
  const trackCandidateFingerprints = new Set();
  let textTrackRowsByKey = new Map();
  let latestVideoMetadata = { title: "", episode: "" };
  let activeVideoKey = currentVideoKey();
  let cueRepeat = null;
  let lastCueRepeat = null;
  let studyPlaylist = null;
  let viewingMode = "watch";
  let selectedStudyCueIndices = new Set();
  let studySelectionRevision = 0;
  let renderedCueIndices = [];

  function emptyCaptureState() {
    return {
      active: false,
      rows: [],
      current: null,
      lastVideoTime: null,
      segmentCount: 1,
      source: "none",
      startedAt: null
    };
  }

  function noVideoState() {
    return {
      detected: false,
      playing: false,
      paused: true,
      seeking: false,
      ended: false,
      currentTime: 0,
      duration: 0,
      playbackRate: 1,
      readyState: 0,
      videoWidth: 0,
      videoHeight: 0,
      pageVisible: document.visibilityState === "visible",
      fullscreen: Boolean(document.fullscreenElement),
      pageTitle: document.title,
      pageUrl: location.href,
      sampledAt: Date.now()
    };
  }

  function visibleArea(video) {
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    if (
      rect.width < 2 ||
      rect.height < 2 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return 0;
    }
    const visibleWidth = Math.max(
      0,
      Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)
    );
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
    );
    return visibleWidth * visibleHeight;
  }

  function isRenderedElement(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0
    );
  }

  function textFromRenderedElements(selector) {
    const texts = [];
    for (const element of document.querySelectorAll(selector)) {
      if (!isRenderedElement(element)) {
        continue;
      }
      const text = core.cleanCapturedSubtitle(element.innerText || element.textContent || "");
      if (text && !texts.includes(text)) {
        texts.push(text);
      }
    }
    return core.cleanCapturedSubtitle(texts.join(" "));
  }

  function readRenderedCaption() {
    for (const selector of NETFLIX_CAPTION_SELECTORS) {
      const text = textFromRenderedElements(selector);
      if (text) {
        return { text, source: "netflix_native" };
      }
    }
    for (const selector of DISNEY_CAPTION_SELECTORS) {
      const text = textFromRenderedElements(selector);
      if (text) {
        return { text, source: "disney_native" };
      }
    }
    const textTrackCaption = readActiveTextTrackCaption();
    if (textTrackCaption) {
      return { text: textTrackCaption, source: "browser_text_track" };
    }
    const languageReactorText = textFromRenderedElements("#lln-subs-content");
    return languageReactorText
      ? { text: languageReactorText, source: "language_reactor" }
      : { text: "", source: "none" };
  }

  function readActiveTextTrackCaption() {
    const video = findMainVideo();
    if (!video?.textTracks) {
      return "";
    }
    const texts = [];
    for (const track of video.textTracks) {
      if (track.mode === "disabled" || !track.activeCues) {
        continue;
      }
      for (const cue of track.activeCues) {
        const text = core.cleanCapturedSubtitle(cue.text || "");
        if (text && !texts.includes(text)) {
          texts.push(text);
        }
      }
    }
    return core.cleanCapturedSubtitle(texts.join(" "));
  }

  function currentProvider() {
    if (location.hostname.endsWith("disneyplus.com")) {
      return { id: "disney", label: "DisneyPlus" };
    }
    if (location.hostname.endsWith("netflix.com")) {
      return { id: "netflix", label: "Netflix" };
    }
    return { id: "web", label: "Web" };
  }

  function currentVideoKey() {
    const provider = currentProvider();
    const netflixId = location.pathname.match(/\/watch\/(\d+)/)?.[1];
    return netflixId
      ? `netflix:${netflixId}`
      : `${provider.id}:${location.pathname}`;
  }

  function syncVideoContext() {
    const nextVideoKey = currentVideoKey();
    if (nextVideoKey === activeVideoKey) {
      return false;
    }
    activeVideoKey = nextVideoKey;
    trackCandidates = [];
    trackCandidateFingerprints.clear();
    textTrackRowsByKey = new Map();
    latestVideoMetadata = { title: "", episode: "" };
    cueRepeat = null;
    lastCueRepeat = null;
    studyPlaylist = null;
    return true;
  }

  function scoreVideo(video) {
    const activelyPlaying = !video.paused && !video.ended && video.readyState >= 2;
    return visibleArea(video) + (activelyPlaying ? 1_000_000_000 : 0);
  }

  function findMainVideo() {
    const videos = [...document.querySelectorAll("video")];
    for (const video of videos) {
      observeVideo(video);
    }
    return videos
      .filter((video) => visibleArea(video) > 0)
      .sort((left, right) => scoreVideo(right) - scoreVideo(left))[0] || null;
  }

  function observeVideo(video) {
    if (observedVideos.has(video)) {
      return;
    }
    observedVideos.add(video);
    for (const eventName of MEDIA_EVENTS) {
      video.addEventListener(eventName, samplePlaybackState, { passive: true });
    }
  }

  function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function stateFromVideo(video) {
    return {
      detected: true,
      playing: !video.paused && !video.ended,
      paused: video.paused,
      seeking: video.seeking,
      ended: video.ended,
      currentTime: finiteNumber(video.currentTime),
      duration: finiteNumber(video.duration),
      playbackRate: finiteNumber(video.playbackRate, 1),
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      pageVisible: document.visibilityState === "visible",
      fullscreen: Boolean(document.fullscreenElement),
      pageTitle: document.title,
      pageUrl: location.href,
      sampledAt: Date.now()
    };
  }

  function formatTime(totalSeconds) {
    const milliseconds = Math.max(0, Math.round(totalSeconds * 1000));
    const hours = Math.floor(milliseconds / 3_600_000);
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((milliseconds % 60_000) / 1000);
    const remainder = milliseconds % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
  }

  function activeSurface() {
    return document.fullscreenElement || document.documentElement;
  }

  function placeOnActiveSurface(host) {
    const target = activeSurface();
    if (host.parentElement !== target) {
      target.append(host);
    }
  }

  function createProbePanel() {
    const host = document.createElement("div");
    host.id = "subtitle-sync-probe-host";
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("top", "16px", "important");
    host.style.setProperty("right", "16px", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("pointer-events", "none", "important");

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .panel {
        width: 280px;
        box-sizing: border-box;
        border: 1px solid rgba(190, 255, 74, 0.7);
        border-radius: 12px;
        background: rgba(8, 10, 8, 0.92);
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);
        color: #f5f5ef;
        font: 13px/1.45 Arial, sans-serif;
        padding: 13px 14px;
      }
      .header { color: #beff4a; font-weight: 700; letter-spacing: 0.08em; }
      .status { margin-top: 7px; font-size: 15px; font-weight: 700; }
      .grid { display: grid; grid-template-columns: 92px 1fr; gap: 4px 8px; margin-top: 9px; }
      .label { color: #9a9d93; }
      .value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hint { color: #9a9d93; font-size: 11px; margin-top: 9px; }
    `;
    const panel = document.createElement("section");
    panel.className = "panel";
    const header = document.createElement("div");
    header.className = "header";
    header.textContent = "SUBTITLE SYNC";
    const status = document.createElement("div");
    status.className = "status";
    const grid = document.createElement("div");
    grid.className = "grid";
    const rows = {};
    for (const [key, label] of [
      ["time", "Time"],
      ["duration", "Duration"],
      ["rate", "Rate"],
      ["resolution", "Video"],
      ["fullscreen", "Fullscreen"],
      ["subtitles", "Subtitles"]
    ]) {
      const labelNode = document.createElement("span");
      labelNode.className = "label";
      labelNode.textContent = label;
      const valueNode = document.createElement("span");
      valueNode.className = "value";
      grid.append(labelNode, valueNode);
      rows[key] = valueNode;
    }
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Local SRT only - no video or audio is captured.";
    panel.append(header, status, grid, hint);
    shadow.append(style, panel);
    activeSurface().append(host);
    probeElements = { host, status, rows };
  }

  function createSubtitleLayer() {
    const host = document.createElement("div");
    host.id = "subtitle-sync-renderer-host";
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("left", "5vw", "important");
    host.style.setProperty("right", "5vw", "important");
    host.style.setProperty("z-index", "2147483646", "important");
    host.style.setProperty("pointer-events", "none", "important");
    host.style.setProperty("text-align", "center", "important");

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      .subtitle {
        display: none;
        max-width: min(90vw, 1400px);
        margin: 0 auto;
        box-sizing: border-box;
        color: #fff;
        background: rgba(0, 0, 0, 0.58);
        border-radius: 8px;
        padding: 0.15em 0.45em 0.22em;
        font-family: "Segoe UI", Tahoma, Arial, sans-serif;
        font-weight: 600;
        line-height: 1.35;
        white-space: pre-line;
        overflow-wrap: anywhere;
        direction: auto;
        unicode-bidi: plaintext;
        text-shadow: 0 2px 4px #000, 0 0 2px #000;
      }
      .subtitle.study {
        cursor: pointer;
        pointer-events: auto;
        border: 2px solid rgba(185, 255, 90, 0.45);
      }
      .subtitle.study:hover { border-color: #b9ff5a; }
      .subtitle.selected {
        border-color: #b9ff5a;
        background: rgba(20, 45, 10, 0.82);
        box-shadow: 0 0 0 2px rgba(185, 255, 90, 0.22);
      }
    `;
    const subtitle = document.createElement("div");
    subtitle.className = "subtitle";
    subtitle.setAttribute("role", "status");
    subtitle.setAttribute("aria-live", "off");
    subtitle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleRenderedStudyCues();
    });
    subtitle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        toggleRenderedStudyCues();
      }
    });
    shadow.append(style, subtitle);
    activeSurface().append(host);
    subtitleElements = { host, subtitle };
  }

  function ensureProbePlacement() {
    if (!probeElements?.host?.isConnected) {
      createProbePanel();
    }
    placeOnActiveSurface(probeElements.host);
  }

  function ensureSubtitlePlacement() {
    if (!subtitleElements?.host?.isConnected) {
      createSubtitleLayer();
    }
    placeOnActiveSurface(subtitleElements.host);
  }

  function renderProbe(state) {
    if (!settings.showDiagnostics) {
      if (probeElements?.host) {
        probeElements.host.style.setProperty("display", "none", "important");
      }
      return;
    }
    ensureProbePlacement();
    probeElements.host.style.setProperty("display", "block", "important");
    const { status, rows } = probeElements;
    if (!state.detected) {
      status.textContent = "No visible video detected";
      rows.time.textContent = "--";
      rows.duration.textContent = "--";
      rows.rate.textContent = "--";
      rows.resolution.textContent = "--";
      rows.fullscreen.textContent = state.fullscreen ? "Yes" : "No";
    } else {
      status.textContent = state.playing ? "PLAYING" : state.seeking ? "SEEKING" : "PAUSED";
      rows.time.textContent = formatTime(state.currentTime);
      rows.duration.textContent = formatTime(state.duration);
      rows.rate.textContent = `${state.playbackRate.toFixed(2)}x`;
      rows.resolution.textContent = `${state.videoWidth} x ${state.videoHeight}`;
      rows.fullscreen.textContent = state.fullscreen ? "Yes" : "No";
    }
    rows.subtitles.textContent = subtitleCues.length ? `${subtitleCues.length} loaded` : "None";
  }

  function renderSubtitle(state) {
    ensureSubtitlePlacement();
    const { host, subtitle } = subtitleElements;
    if (!settings.showSubtitles) {
      host.style.setProperty("display", "none", "important");
      renderedCueIndices = [];
      return;
    }
    host.style.setProperty("display", "block", "important");
    host.style.setProperty("bottom", `${settings.bottomPercent}vh`, "important");
    subtitle.style.fontSize = `${settings.fontSizePx}px`;
    renderedCueIndices = state.detected
      ? core.activeSubtitleCueIndices(subtitleCues, state.currentTime, settings.offsetSeconds)
      : [];
    const text = renderedCueIndices.map((index) => subtitleCues[index]?.text || "").join("\n");
    if (!text) {
      subtitle.style.display = "none";
      subtitle.textContent = "";
      subtitle.classList.remove("study", "selected");
      subtitle.removeAttribute("tabindex");
      return;
    }
    subtitle.textContent = text;
    subtitle.style.display = "inline-block";
    const studyEnabled = viewingMode === "study";
    const selected = renderedCueIndices.length > 0
      && renderedCueIndices.every((index) => selectedStudyCueIndices.has(index));
    subtitle.classList.toggle("study", studyEnabled);
    subtitle.classList.toggle("selected", studyEnabled && selected);
    subtitle.setAttribute("role", studyEnabled ? "button" : "status");
    subtitle.title = studyEnabled
      ? selected ? "Remove from study list" : "Save to study list"
      : "";
    if (studyEnabled) {
      subtitle.setAttribute("tabindex", "0");
    } else {
      subtitle.removeAttribute("tabindex");
    }
  }

  async function saveStudySelection() {
    if (!subtitleListId) {
      return;
    }
    const stored = await chrome.storage.local.get({ [STUDY_SELECTIONS_KEY]: {} });
    const selections = stored[STUDY_SELECTIONS_KEY] || {};
    selections[subtitleListId] = {
      cueIndices: [...selectedStudyCueIndices].sort((left, right) => left - right),
      updatedAt: Date.now()
    };
    const retained = Object.fromEntries(
      Object.entries(selections)
        .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
        .slice(0, 20)
    );
    await chrome.storage.local.set({ [STUDY_SELECTIONS_KEY]: retained });
  }

  async function restoreStudySelection() {
    selectedStudyCueIndices = new Set();
    if (subtitleListId) {
      const stored = await chrome.storage.local.get({ [STUDY_SELECTIONS_KEY]: {} });
      const saved = stored[STUDY_SELECTIONS_KEY]?.[subtitleListId];
      for (const rawIndex of saved?.cueIndices || []) {
        const index = Number(rawIndex);
        if (Number.isInteger(index) && subtitleCues[index]) {
          selectedStudyCueIndices.add(index);
        }
      }
    }
    studySelectionRevision += 1;
  }

  async function replaceStudySelection(rawIndices) {
    selectedStudyCueIndices = new Set(
      rawIndices
        .map(Number)
        .filter((index) => Number.isInteger(index) && subtitleCues[index])
    );
    studySelectionRevision += 1;
    await saveStudySelection();
    renderSubtitle(latestState);
  }

  function toggleRenderedStudyCues() {
    if (viewingMode !== "study" || !renderedCueIndices.length || !subtitleListId) {
      return;
    }
    const remove = renderedCueIndices.every((index) => selectedStudyCueIndices.has(index));
    for (const index of renderedCueIndices) {
      if (remove) {
        selectedStudyCueIndices.delete(index);
      } else {
        selectedStudyCueIndices.add(index);
      }
    }
    studySelectionRevision += 1;
    renderSubtitle(latestState);
    saveStudySelection().catch(() => {});
  }

  function closeCapturedCue(endSeconds) {
    if (!capture.current?.text) {
      capture.current = null;
      return;
    }
    const end = Math.max(capture.current.start + 0.08, Number(endSeconds));
    capture.rows.push({
      start: capture.current.start,
      end,
      text: capture.current.text,
      source: capture.current.source,
      segment: capture.segmentCount
    });
    capture.current = null;
  }

  function updateCapture(video) {
    if (!capture.active || !video) {
      return;
    }
    const currentTime = finiteNumber(video.currentTime);
    if (
      capture.lastVideoTime !== null &&
      currentTime < capture.lastVideoTime - 10
    ) {
      closeCapturedCue(capture.lastVideoTime);
      capture.segmentCount += 1;
    }

    const caption = readRenderedCaption();
    if (!caption.text) {
      if (capture.current) {
        closeCapturedCue(currentTime);
      }
      capture.lastVideoTime = currentTime;
      return;
    }

    capture.source = caption.source;
    if (!capture.current) {
      capture.current = {
        start: currentTime,
        text: caption.text,
        source: caption.source
      };
    } else if (capture.current.text !== caption.text) {
      closeCapturedCue(currentTime);
      capture.current = {
        start: currentTime,
        text: caption.text,
        source: caption.source
      };
    }
    capture.lastVideoTime = currentTime;
  }

  function capturedRowsSnapshot() {
    const rows = capture.rows.map((row) => ({ ...row }));
    if (capture.current?.text) {
      rows.push({
        start: capture.current.start,
        end: Math.max(capture.current.start + 0.08, latestState.currentTime),
        text: capture.current.text,
        source: capture.current.source,
        segment: capture.segmentCount
      });
    }
    return rows;
  }

  function startCapture(playbackRate) {
    const video = findMainVideo();
    if (!video) {
      throw new Error("No visible Netflix, Disney+, or YouTube video was found.");
    }
    if (cueRepeat) {
      throw new Error("Stop subtitle repetition before starting capture.");
    }
    capture = emptyCaptureState();
    capture.active = true;
    capture.startedAt = Date.now();
    if (Number.isFinite(playbackRate) && playbackRate > 0) {
      video.playbackRate = core.clamp(playbackRate, 0.25, 4);
    }
    updateCapture(video);
  }

  function stopCapture() {
    if (capture.active) {
      const video = findMainVideo();
      closeCapturedCue(video ? finiteNumber(video.currentTime) : capture.lastVideoTime || 0);
    }
    capture.active = false;
  }

  function exportCapture(format) {
    const rows = capturedRowsSnapshot();
    if (!rows.length) {
      throw new Error(
        "No subtitles were captured. Enable an OTT subtitle track and play the video first."
      );
    }
    const extension = format === "srt" ? "srt" : "csv";
    return {
      content: extension === "srt"
        ? core.capturedRowsToSrt(rows)
        : core.capturedRowsToCsv(rows),
      filename: `captured_subs.${extension}`,
      mimeType: extension === "srt" ? "application/x-subrip" : "text/csv",
      rowCount: rows.length
    };
  }

  function samplePlaybackState() {
    syncVideoContext();
    const video = findMainVideo();
    updateCueRepeat(video);
    latestState = video ? stateFromVideo(video) : noVideoState();
    scanSelectedTextTrack(video);
    updateCapture(video);
    renderProbe(latestState);
    renderSubtitle(latestState);
    return playbackStatus();
  }

  function playbackStatus() {
    return {
      ...latestState,
      subtitleFilename,
      subtitleListId,
      subtitleCueCount: subtitleCues.length,
      subtitleSettings: { ...settings },
      captureActive: capture.active,
      capturedCueCount: capture.rows.length + (capture.current ? 1 : 0),
      captureSource: capture.source,
      captureSegmentCount: capture.segmentCount,
      cueRepeatStatus: cueRepeat
        ? { active: true, ...cueRepeat }
        : lastCueRepeat,
      studyPlaylistStatus: studyPlaylist
        ? {
            active: true,
            position: studyPlaylist.position,
            total: studyPlaylist.cueIndices.length
          }
        : null,
      viewingMode,
      selectedStudyCueCount: selectedStudyCueIndices.size,
      studySelectionRevision,
      trackProbeActive,
      trackCandidates: trackCandidates.map(({ content: _content, ...summary }) => summary)
    };
  }

  function subtitleCueSummaries() {
    return subtitleCues.map((cue, index) => ({
      index,
      start: cue.start,
      end: cue.end,
      text: String(cue.text || "").slice(0, 500)
    }));
  }

  function startCueRepeat(cueIndex, repeatCount = 5, { fromPlaylist = false } = {}) {
    if (viewingMode !== "study") {
      throw new Error("Switch to Study mode before repeating subtitles.");
    }
    if (capture.active) {
      throw new Error("Stop subtitle capture before repeating a cue.");
    }
    const cue = subtitleCues[Number(cueIndex)];
    if (!cue) {
      throw new Error("The selected subtitle cue is no longer available.");
    }
    const video = findMainVideo();
    if (!video) {
      throw new Error("No visible video was found.");
    }
    const bounds = core.cuePlaybackBounds(cue, settings.offsetSeconds);
    const end = Number.isFinite(video.duration)
      ? Math.min(bounds.end, video.duration)
      : bounds.end;
    if (end <= bounds.start) {
      throw new Error("This subtitle ends outside the playable video range.");
    }
    cueRepeat = {
      cueIndex: Number(cueIndex),
      completed: 0,
      total: Math.round(core.clamp(Number(repeatCount), 1, 20)),
      start: bounds.start,
      end
    };
    if (!fromPlaylist) {
      studyPlaylist = null;
    }
    lastCueRepeat = null;
    video.currentTime = cueRepeat.start;
    const startedRepeat = cueRepeat;
    video.play().catch(() => {
      if (cueRepeat === startedRepeat) {
        cueRepeat = null;
        lastCueRepeat = null;
      }
    });
  }

  function stopCueRepeat({ pause = true } = {}) {
    const video = findMainVideo();
    if (pause && video) {
      video.pause();
    }
    if (cueRepeat) {
      lastCueRepeat = { active: false, stopped: true, ...cueRepeat };
      cueRepeat = null;
    }
    studyPlaylist = null;
  }

  function startStudyPlaylist(rawCueIndices, repeatCount = 5) {
    if (viewingMode !== "study") {
      throw new Error("Switch to Study mode before playing selected subtitles.");
    }
    if (capture.active) {
      throw new Error("Stop subtitle capture before starting a study playlist.");
    }
    const cueIndices = [...new Set(rawCueIndices.map(Number))]
      .filter((index) => Number.isInteger(index) && subtitleCues[index])
      .sort((left, right) => subtitleCues[left].start - subtitleCues[right].start);
    if (!cueIndices.length) {
      throw new Error("Select at least one subtitle for the study playlist.");
    }
    studyPlaylist = {
      cueIndices,
      position: 0,
      repeatCount: Math.round(core.clamp(Number(repeatCount), 1, 20))
    };
    startCueRepeat(cueIndices[0], studyPlaylist.repeatCount, { fromPlaylist: true });
  }

  function updateCueRepeat(video) {
    if (!cueRepeat || !video) {
      return;
    }
    if (finiteNumber(video.currentTime) < cueRepeat.end) {
      return;
    }
    cueRepeat.completed += 1;
    if (cueRepeat.completed >= cueRepeat.total) {
      const completedRepeat = { active: false, stopped: false, ...cueRepeat };
      cueRepeat = null;
      if (studyPlaylist) {
        studyPlaylist.position += 1;
        if (studyPlaylist.position < studyPlaylist.cueIndices.length) {
          const nextCueIndex = studyPlaylist.cueIndices[studyPlaylist.position];
          startCueRepeat(nextCueIndex, studyPlaylist.repeatCount, { fromPlaylist: true });
          return;
        }
        video.pause();
        video.currentTime = completedRepeat.end;
        lastCueRepeat = { ...completedRepeat, playlistComplete: true };
        studyPlaylist = null;
        return;
      }
      lastCueRepeat = { ...completedRepeat, continuedPlayback: true };
      video.play().catch(() => {});
      return;
    }
    video.currentTime = cueRepeat.start;
    const continuingRepeat = cueRepeat;
    video.play().catch(() => {
      if (cueRepeat === continuingRepeat) {
        stopCueRepeat({ pause: false });
      }
    });
  }

  function estimateTimedTextCues(content, format) {
    if (format === "srt") {
      return (String(content).match(/-->/g) || []).length;
    }
    if (format === "webvtt") {
      return (String(content).match(/-->/g) || []).length;
    }
    if (format === "ttml") {
      return (String(content).match(/<p\b/gi) || []).length;
    }
    if (format === "xml_timed_text") {
      return (String(content).match(/<text\b/gi) || []).length;
    }
    return 0;
  }

  function setTrackProbeActive(
    active,
    { clearLocal = false, clearPage = false, replayCandidates = true } = {}
  ) {
    trackProbeActive = Boolean(active);
    if (clearLocal) {
      trackCandidates = [];
      trackCandidateFingerprints.clear();
    }
    window.postMessage(
      {
        source: TRACK_PROBE_CONTROL_SOURCE,
        type: "SET_TRACK_PROBE_ACTIVE",
        active: trackProbeActive,
        clearCandidates: Boolean(clearPage),
        replayCandidates: Boolean(replayCandidates)
      },
      "*"
    );
  }

  function filenamePart(value, fallback = "") {
    const cleaned = String(value || "")
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim();
    return (cleaned || fallback).slice(0, 100);
  }

  function metadataFromText(value) {
    const parsed = core.parseNetflixVideoLabel(value);
    return {
      title: filenamePart(parsed.title),
      episode: filenamePart(parsed.episode)
    };
  }

  function ottVideoMetadata() {
    syncVideoContext();
    const provider = currentProvider();
    const documentTitle = document.title
      .replace(/\s*[-|]\s*(?:Netflix|Disney\+)\s*$/i, "")
      .replace(/^(?:Netflix|Disney\+)\s*[-|]\s*/i, "")
      .trim();
    const elements = [
      ...document.querySelectorAll(
        '[data-uia="video-title"], [data-uia*="title"], [data-testid="title"], [data-testid*="title"], .watch-video--title-text, [class*="title"], h1, h2, h3, h4'
      )
    ].slice(0, 500);
    let best = { title: "", episode: "", score: -1 };
    for (const element of elements) {
      const text = String(
        element.innerText || element.textContent || element.getAttribute("aria-label") || ""
      ).trim();
      if (!text || text.length > 300 || !/\bE\s*\d+\b|\bEpisode\s*\d+\b|시즌\s*\d+|\d+화\b/i.test(text)) {
        continue;
      }
      const parsed = metadataFromText(text);
      const score = (parsed.title ? 20 : 0) + (parsed.episode ? 100 : 0) - text.length / 1000;
      if (score > best.score) {
        best = { ...parsed, score };
      }
    }
    if (best.episode) {
      latestVideoMetadata = {
        title: best.title || filenamePart(documentTitle),
        episode: best.episode
      };
    }
    const videoId = location.pathname.match(/\/watch\/(\d+)/)?.[1]
      || location.pathname.split("/").filter(Boolean).at(-1)
      || "video";
    return {
      provider,
      episode: latestVideoMetadata.episode,
      title: filenamePart(
        latestVideoMetadata.title || documentTitle,
        `${provider.label}_${videoId}`
      )
    };
  }

  function timedTextLanguage(content) {
    const match = String(content || "").match(
      /\b(?:xml:lang|lang)\s*=\s*["']([^"']+)["']/i
    );
    return filenamePart(match?.[1] || "");
  }

  function addTrackCandidate(payload) {
    if (!trackProbeActive || !payload?.content || !payload?.fingerprint) {
      return;
    }
    syncVideoContext();
    const videoKey = String(payload.videoKey || currentVideoKey());
    if (videoKey !== activeVideoKey) {
      return;
    }
    if (trackCandidateFingerprints.has(payload.fingerprint)) {
      return;
    }
    const format = String(payload.format || "unknown");
    const videoMetadata = ottVideoMetadata();
    const cueEstimate = estimateTimedTextCues(payload.content, format);
    const nextCandidate = {
      content: String(payload.content),
      contentType: String(payload.contentType || ""),
      cueEstimate,
      fingerprint: String(payload.fingerprint),
      format,
      path: String(payload.path || "unknown"),
      size: Number(payload.size || String(payload.content).length),
      transport: String(payload.transport || "unknown"),
      videoKey,
      videoTitle: videoMetadata.title,
      episodeTitle: videoMetadata.episode,
      language: filenamePart(payload.language || timedTextLanguage(payload.content))
    };
    const existingIndex = trackCandidates.findIndex(
      (candidate) =>
        candidate.videoKey === videoKey &&
        (candidate.language || "unknown") === (nextCandidate.language || "unknown")
    );
    if (existingIndex >= 0) {
      if (cueEstimate < trackCandidates[existingIndex].cueEstimate) {
        return;
      }
      trackCandidateFingerprints.add(payload.fingerprint);
      trackCandidates[existingIndex] = nextCandidate;
      return;
    }
    if (trackCandidates.length >= 12) {
      return;
    }
    const totalCharacters = trackCandidates.reduce(
      (total, candidate) => total + candidate.content.length,
      0
    );
    if (totalCharacters + payload.content.length > 24_000_000) {
      return;
    }
    trackCandidateFingerprints.add(payload.fingerprint);
    trackCandidates.push(nextCandidate);
  }

  function scanSelectedTextTrack(video) {
    if (!trackProbeActive || !video?.textTracks) {
      return;
    }
    for (let trackIndex = 0; trackIndex < video.textTracks.length; trackIndex += 1) {
      const track = video.textTracks[trackIndex];
      const cues = track.mode === "showing" ? Array.from(track.cues || []) : [];
      if (!cues.length) {
        continue;
      }
      const rows = cues
        .map((cue) => ({
          start: Number(cue.startTime),
          end: Number(cue.endTime),
          text: core.cleanCapturedSubtitle(String(cue.text || "").replace(/<[^>]*>/g, ""))
        }))
        .filter((cue) => cue.text && Number.isFinite(cue.start) && cue.end > cue.start);
      if (!rows.length) {
        continue;
      }
      const trackKey = `${activeVideoKey}:${trackIndex}:${track.language || track.label || ""}`;
      const accumulated = textTrackRowsByKey.get(trackKey) || new Map();
      for (const row of rows) {
        accumulated.set(`${row.start}:${row.end}:${row.text}`, row);
      }
      textTrackRowsByKey.set(trackKey, accumulated);
      const accumulatedRows = [...accumulated.values()].sort(
        (left, right) => left.start - right.start || left.end - right.end
      );
      const content = core.capturedRowsToSrt(accumulatedRows);
      const first = accumulatedRows[0];
      const last = accumulatedRows.at(-1);
      addTrackCandidate({
        content,
        contentType: "application/x-subrip",
        fingerprint: `text-track-${activeVideoKey}-${trackIndex}-${accumulatedRows.length}-${first.start}-${last.end}`,
        format: "srt",
        path: "browser-text-track",
        size: content.length,
        transport: "text-track",
        videoKey: activeVideoKey,
        language: String(track.language || track.label || "")
      });
    }
  }

  function exportTrackCandidate(index) {
    const candidate = trackCandidates[Number(index)];
    if (!candidate) {
      throw new Error("The selected subtitle track candidate is no longer available.");
    }
    const extensions = {
      webvtt: "vtt",
      srt: "srt",
      ttml: "ttml",
      xml_timed_text: "xml",
      json_candidate: "json",
      unknown: "txt"
    };
    const extension = extensions[candidate.format] || "txt";
    const currentMetadata = ottVideoMetadata();
    const candidateTitle = String(candidate.videoTitle || "");
    const filename = [
      /^(?:Netflix|DisneyPlus)_/.test(candidateTitle) ? currentMetadata.title : candidateTitle,
      candidate.episodeTitle || currentMetadata.episode,
      candidate.language
    ]
      .map((part) => filenamePart(part))
      .filter(Boolean)
      .join(" - ");
    return {
      content: candidate.content,
      filename: `${filename || `${currentMetadata.provider.label}_subtitles_${index + 1}`}.${extension}`,
      mimeType: candidate.contentType || "text/plain"
    };
  }

  function updateSettings(nextSettings) {
    settings = {
      offsetSeconds: core.clamp(
        Number(nextSettings?.offsetSeconds ?? settings.offsetSeconds),
        -30,
        30
      ),
      fontSizePx: core.clamp(
        Number(nextSettings?.fontSizePx ?? settings.fontSizePx),
        20,
        72
      ),
      bottomPercent: core.clamp(
        Number(nextSettings?.bottomPercent ?? settings.bottomPercent),
        3,
        45
      ),
      showSubtitles: Boolean(nextSettings?.showSubtitles ?? settings.showSubtitles),
      showDiagnostics: Boolean(nextSettings?.showDiagnostics ?? settings.showDiagnostics)
    };
  }

  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.data?.source === TRACK_PROBE_EVENT_SOURCE &&
      event.data?.type === "TRACK_CANDIDATE"
    ) {
      addTrackCandidate(event.data.payload);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (message?.type === "GET_PLAYBACK_STATE") {
        sendResponse(samplePlaybackState());
        return;
      }
      if (message?.type === "LOAD_SRT") {
        stopCueRepeat({ pause: false });
        subtitleCues = core.parseSrt(String(message.content || ""));
        subtitleFilename = String(message.filename || "subtitles.srt");
        subtitleListId = String(message.subtitleListId || "");
        lastCueRepeat = null;
        restoreStudySelection()
          .then(() => sendResponse({ ok: true, ...samplePlaybackState() }))
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          }));
        return true;
      }
      if (message?.type === "GET_SUBTITLE_CUES") {
        sendResponse({
          ok: true,
          subtitleFilename,
          subtitleListId,
          selectedCueIndices: [...selectedStudyCueIndices],
          cues: subtitleCueSummaries()
        });
        return;
      }
      if (message?.type === "REPEAT_SUBTITLE_CUE") {
        startCueRepeat(message.cueIndex, message.repeatCount);
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "STOP_SUBTITLE_REPEAT") {
        stopCueRepeat();
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "PLAY_STUDY_PLAYLIST") {
        startStudyPlaylist(
          Array.isArray(message.cueIndices) ? message.cueIndices : [],
          message.repeatCount
        );
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "SET_VIEWING_MODE") {
        const nextMode = message.mode === "study" ? "study" : "watch";
        if (nextMode === "watch" && (cueRepeat || studyPlaylist)) {
          stopCueRepeat({ pause: false });
        }
        viewingMode = nextMode;
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "SET_STUDY_SELECTIONS") {
        replaceStudySelection(
          Array.isArray(message.cueIndices) ? message.cueIndices : []
        )
          .then(() => sendResponse({ ok: true, ...samplePlaybackState() }))
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          }));
        return true;
      }
      if (message?.type === "SET_SUBTITLE_SETTINGS") {
        updateSettings(message.settings);
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "CLEAR_SUBTITLES") {
        stopCueRepeat({ pause: false });
        subtitleCues = [];
        subtitleFilename = "";
        subtitleListId = "";
        selectedStudyCueIndices = new Set();
        studySelectionRevision += 1;
        lastCueRepeat = null;
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "START_CAPTURE") {
        startCapture(Number(message.playbackRate));
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "STOP_CAPTURE") {
        stopCapture();
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "CLEAR_CAPTURE") {
        capture = emptyCaptureState();
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "EXPORT_CAPTURE") {
        sendResponse({
          ok: true,
          ...playbackStatus(),
          ...exportCapture(String(message.format || "csv"))
        });
        return;
      }
      if (message?.type === "START_TRACK_PROBE") {
        setTrackProbeActive(true, {
          clearLocal: true,
          replayCandidates: true
        });
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "STOP_TRACK_PROBE") {
        setTrackProbeActive(false, { replayCandidates: false });
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "CLEAR_TRACK_PROBE") {
        setTrackProbeActive(true, {
          clearLocal: true,
          clearPage: true,
          replayCandidates: false
        });
        sendResponse({ ok: true, ...samplePlaybackState() });
        return;
      }
      if (message?.type === "EXPORT_TRACK_CANDIDATE") {
        sendResponse({
          ok: true,
          ...playbackStatus(),
          ...exportTrackCandidate(message.index)
        });
      }
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  document.addEventListener("visibilitychange", samplePlaybackState, { passive: true });
  document.addEventListener("fullscreenchange", samplePlaybackState, { passive: true });
  setTrackProbeActive(true, { replayCandidates: true });
  setInterval(ottVideoMetadata, 500);
  setInterval(samplePlaybackState, UPDATE_INTERVAL_MS);
  samplePlaybackState();
})();
