(() => {
  "use strict";

  if (window.top !== window || window.__subtitleCompanionLoaded) return;
  window.__subtitleCompanionLoaded = true;

  const core = globalThis.CustomerSubtitleCore;
  const SETTINGS_KEY = "customerOverlaySettings";
  const SELECTIONS_KEY = "customerStudySelections";
  const defaults = {
    mode: "watch",
    visible: true,
    offsetSeconds: 0,
    fontSizePx: 38,
    bottomPercent: 10,
    repeatCount: 5,
    secondaryFontSizePx: 34,
    secondaryBottomPercent: 20
  };

  let settings = { ...defaults };
  let cues = [];
  let secondaryCues = [];
  let trackId = "";
  let secondaryTrackId = "";
  let trackLabel = "";
  let secondaryTrackLabel = "";
  let selections = new Set();
  let playlist = null;
  let renderedKey = "";

  const host = document.createElement("div");
  host.id = "subtitle-companion-host";
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    pointerEvents: "none",
    fontFamily: "Inter, Segoe UI, sans-serif"
  });
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .line { position: fixed; left: 6%; right: 6%; display: flex; justify-content: center; pointer-events: none; }
    .cue { max-width: min(1100px, 90vw); border: 0; border-radius: 12px; padding: 8px 14px;
      color: white; background: rgba(9, 24, 35, .72); box-shadow: 0 4px 18px rgba(0,0,0,.34);
      text-align: center; white-space: pre-line; line-height: 1.3; text-shadow: 0 2px 4px #000;
      font-weight: 650; pointer-events: none; }
    #primaryCue.study { pointer-events: auto; cursor: pointer; outline: 2px solid rgba(88, 204, 180, .8); }
    #primaryCue.selected { background: rgba(17, 94, 89, .88); outline-color: #f5c96a; }
    #secondaryCue { background: rgba(31, 40, 62, .78); }
    #badge { position: absolute; top: -25px; left: 50%; transform: translateX(-50%); color: #d8fff5;
      font: 600 12px/1.2 Inter, Segoe UI, sans-serif; background: rgba(8, 47, 52, .9);
      border-radius: 999px; padding: 4px 9px; white-space: nowrap; }
  `;

  const primaryLine = document.createElement("div");
  primaryLine.className = "line";
  primaryLine.id = "primaryLine";
  const primaryCue = document.createElement("button");
  primaryCue.id = "primaryCue";
  primaryCue.className = "cue";
  primaryCue.type = "button";
  const badge = document.createElement("span");
  badge.id = "badge";
  badge.hidden = true;
  primaryCue.append(badge, document.createTextNode(""));
  primaryLine.append(primaryCue);

  const secondaryLine = document.createElement("div");
  secondaryLine.className = "line";
  secondaryLine.id = "secondaryLine";
  const secondaryCue = document.createElement("div");
  secondaryCue.id = "secondaryCue";
  secondaryCue.className = "cue";
  secondaryLine.append(secondaryCue);

  shadow.append(style, secondaryLine, primaryLine);
  (document.documentElement || document.body).append(host);

  primaryCue.addEventListener("click", () => {
    if (settings.mode !== "study") return;
    const video = mainVideo();
    const active = video ? core.activeCueIndices(cues, video.currentTime, settings.offsetSeconds) : [];
    for (const index of active) selections.has(index) ? selections.delete(index) : selections.add(index);
    saveSelections();
    renderedKey = "";
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  async function handleMessage(message) {
    switch (message?.type) {
      case "LOAD_AUTHORIZED_TRACK":
        return loadAuthorizedTrack(message);
      case "CLEAR_AUTHORIZED_TRACK":
        return clearAuthorizedTrack(message.slot);
      case "SET_CUSTOMER_SETTINGS":
        settings = sanitizeSettings({ ...settings, ...message.settings });
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        renderedKey = "";
        return stateSnapshot();
      case "CONTROL_PLAYBACK":
        return controlPlayback(message);
      case "REPEAT_CURRENT":
        repeatCurrentCue();
        return stateSnapshot();
      case "PLAY_STUDY_SELECTIONS":
        startPlaylist([...selections].sort((a, b) => a - b));
        return stateSnapshot();
      case "STOP_STUDY_PLAYBACK":
        stopPlaylist(true);
        return stateSnapshot();
      case "CLEAR_STUDY_SELECTIONS":
        selections.clear();
        playlist = null;
        await saveSelections();
        renderedKey = "";
        return stateSnapshot();
      case "GET_STUDY_SELECTIONS":
        return { items: selectedItems() };
      case "JUMP_STUDY_CUE":
        jumpToCue(message.index, true);
        return stateSnapshot();
      case "REMOVE_STUDY_CUE":
        selections.delete(Number(message.index));
        await saveSelections();
        renderedKey = "";
        return { items: selectedItems(), ...stateSnapshot() };
      case "GET_CUSTOMER_STATE":
        return stateSnapshot();
      default:
        return {};
    }
  }

  async function loadAuthorizedTrack(message) {
    const slot = message.slot === "secondary" ? "secondary" : "primary";
    const normalized = core.normalizeCues(message.cues);
    if (slot === "secondary") {
      secondaryCues = normalized;
      secondaryTrackId = String(message.trackId || "");
      secondaryTrackLabel = String(message.label || "Authorized subtitle");
    } else {
      cues = normalized;
      trackId = String(message.trackId || "");
      trackLabel = String(message.label || "Authorized subtitle");
      selections = await loadSelections(trackId);
      playlist = null;
    }
    renderedKey = "";
    return stateSnapshot();
  }

  async function clearAuthorizedTrack(slot = "all") {
    if (slot === "secondary") {
      secondaryCues = [];
      secondaryTrackId = "";
      secondaryTrackLabel = "";
    } else if (slot === "primary") {
      cues = [];
      trackId = "";
      trackLabel = "";
      selections = new Set();
      playlist = null;
    } else {
      cues = [];
      secondaryCues = [];
      trackId = "";
      secondaryTrackId = "";
      trackLabel = "";
      secondaryTrackLabel = "";
      selections = new Set();
      playlist = null;
    }
    renderedKey = "";
    return stateSnapshot();
  }

  function controlPlayback(message) {
    const video = requireVideo();
    if (message.action === "seek") {
      const seconds = clamp(Number(message.seconds), -60, 60, 0);
      video.currentTime = clamp(video.currentTime + seconds, 0, Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER, 0);
    } else if (message.action === "toggle") {
      if (video.paused) video.play().catch(() => null);
      else video.pause();
    } else if (message.action === "speed") {
      video.playbackRate = clamp(Number(message.rate), 0.25, 4, 1);
    } else {
      throw new Error("Unknown playback control.");
    }
    return stateSnapshot();
  }

  function repeatCurrentCue() {
    const video = requireVideo();
    const active = core.activeCueIndices(cues, video.currentTime, settings.offsetSeconds);
    if (!active.length) throw new Error("No subtitle is active at the current playback position.");
    startPlaylist([active[0]]);
  }

  function startPlaylist(indices) {
    const video = requireVideo();
    if (!indices.length) throw new Error("Save at least one subtitle in Study mode first.");
    playlist = { indices, position: 0, repeatsLeft: settings.repeatCount };
    playPlaylistCue(video);
  }

  function stopPlaylist(pause) {
    playlist = null;
    if (pause) mainVideo()?.pause();
  }

  function jumpToCue(index, play) {
    const cue = cues[Number(index)];
    const video = requireVideo();
    if (!cue) throw new Error("That saved subtitle line is no longer available.");
    const bounds = core.playbackBounds(cue, settings.offsetSeconds);
    video.currentTime = bounds.start;
    if (play) video.play().catch(() => null);
  }

  function sanitizeSettings(candidate) {
    return {
      mode: candidate.mode === "study" ? "study" : "watch",
      visible: candidate.visible !== false,
      offsetSeconds: clamp(Number(candidate.offsetSeconds), -30, 30, 0),
      fontSizePx: Math.round(clamp(Number(candidate.fontSizePx), 18, 72, 38)),
      bottomPercent: Math.round(clamp(Number(candidate.bottomPercent), 2, 45, 10)),
      repeatCount: Math.round(clamp(Number(candidate.repeatCount), 1, 20, 5)),
      secondaryFontSizePx: Math.round(clamp(Number(candidate.secondaryFontSizePx), 18, 72, 34)),
      secondaryBottomPercent: Math.round(clamp(Number(candidate.secondaryBottomPercent), 4, 55, 20))
    };
  }

  function clamp(value, minimum, maximum, fallback) {
    return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
  }

  function mainVideo() {
    return [...document.querySelectorAll("video")]
      .filter((video) => video.getBoundingClientRect().width > 1 && video.getBoundingClientRect().height > 1)
      .sort((left, right) => area(right) - area(left))[0] || null;
  }

  function requireVideo() {
    const video = mainVideo();
    if (!video) throw new Error("No active video was detected on this page.");
    return video;
  }

  function area(video) {
    const rect = video.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function render() {
    const video = mainVideo();
    advancePlaylist(video);
    const active = video && cues.length ? core.activeCueIndices(cues, video.currentTime, settings.offsetSeconds) : [];
    const secondaryActive = video && secondaryCues.length ? core.activeCueIndices(secondaryCues, video.currentTime, settings.offsetSeconds) : [];
    const key = [
      settings.visible,
      settings.mode,
      settings.fontSizePx,
      settings.bottomPercent,
      settings.secondaryFontSizePx,
      settings.secondaryBottomPercent,
      active.join(","),
      secondaryActive.join(","),
      [...selections].join(",")
    ].join("|");
    if (key === renderedKey) return;
    renderedKey = key;

    primaryLine.style.bottom = `${settings.bottomPercent}%`;
    primaryCue.style.fontSize = `${settings.fontSizePx}px`;
    const text = active.map((index) => cues[index]?.text).filter(Boolean).join("\n");
    primaryCue.lastChild.nodeValue = text;
    primaryCue.hidden = !settings.visible || !text;
    primaryCue.className = `cue${settings.mode === "study" ? " study" : ""}`;
    primaryCue.classList.toggle("selected", active.some((index) => selections.has(index)));
    badge.hidden = settings.mode !== "study";
    badge.textContent = active.some((index) => selections.has(index)) ? "Saved for study" : "Click to save";

    secondaryLine.style.bottom = `${settings.secondaryBottomPercent}%`;
    secondaryCue.style.fontSize = `${settings.secondaryFontSizePx}px`;
    secondaryCue.textContent = secondaryActive.map((index) => secondaryCues[index]?.text).filter(Boolean).join("\n");
    secondaryCue.hidden = !settings.visible || !secondaryCue.textContent;
  }

  function playPlaylistCue(video = mainVideo()) {
    const cueIndex = playlist?.indices[playlist.position];
    const cue = cues[cueIndex];
    if (!video || !cue) {
      playlist = null;
      return;
    }
    const bounds = core.playbackBounds(cue, settings.offsetSeconds);
    video.currentTime = bounds.start;
    video.play().catch(() => null);
  }

  function advancePlaylist(video) {
    if (!playlist || !video) return;
    const cue = cues[playlist.indices[playlist.position]];
    if (!cue) {
      playlist = null;
      return;
    }
    const bounds = core.playbackBounds(cue, settings.offsetSeconds);
    if (video.currentTime < bounds.end) return;
    if (playlist.repeatsLeft > 1) {
      playlist.repeatsLeft -= 1;
      playPlaylistCue(video);
      return;
    }
    playlist.position += 1;
    if (playlist.position >= playlist.indices.length) {
      playlist = null;
      video.pause();
      return;
    }
    playlist.repeatsLeft = settings.repeatCount;
    playPlaylistCue(video);
  }

  function selectedItems() {
    return [...selections]
      .sort((a, b) => a - b)
      .map((index) => ({ index, ...cues[index] }))
      .filter((cue) => Number.isFinite(cue.start) && cue.text);
  }

  function stateSnapshot() {
    const video = mainVideo();
    return {
      trackId,
      secondaryTrackId,
      trackLabel: secondaryTrackLabel ? `${trackLabel} + ${secondaryTrackLabel}` : trackLabel,
      primaryTrackLabel: trackLabel,
      secondaryTrackLabel,
      cueCount: cues.length,
      secondaryCueCount: secondaryCues.length,
      selectedCount: selections.size,
      videoDetected: Boolean(video),
      videoIdentity: core.pageVideoIdentity(location.href),
      currentTime: video?.currentTime || 0,
      duration: Number.isFinite(video?.duration) ? video.duration : 0,
      playing: Boolean(video && !video.paused),
      playbackRate: video?.playbackRate || 1,
      studyPlaying: Boolean(playlist),
      settings
    };
  }

  async function loadSelections(id) {
    if (!id) return new Set();
    const stored = await chrome.storage.local.get(SELECTIONS_KEY);
    return new Set(stored[SELECTIONS_KEY]?.[id] || []);
  }

  async function saveSelections() {
    if (!trackId) return;
    const stored = await chrome.storage.local.get(SELECTIONS_KEY);
    const all = stored[SELECTIONS_KEY] || {};
    all[trackId] = [...selections].sort((a, b) => a - b);
    await chrome.storage.local.set({ [SELECTIONS_KEY]: all });
  }

  chrome.storage.local.get(SETTINGS_KEY).then((stored) => {
    settings = sanitizeSettings({ ...defaults, ...(stored[SETTINGS_KEY] || {}) });
    return chrome.runtime.sendMessage({ type: "CUSTOMER_CONTENT_READY" });
  }).catch(() => null);

  setInterval(render, 100);
})();
