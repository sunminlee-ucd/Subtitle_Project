(() => {
  "use strict";

  if (window.top !== window || window.__subtitleCompanionLoaded) {
    return;
  }
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
    repeatCount: 5
  };
  let settings = { ...defaults };
  let cues = [];
  let trackId = "";
  let trackLabel = "";
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
    #line { position: fixed; left: 6%; right: 6%; display: flex; justify-content: center; pointer-events: none; }
    #cue { max-width: min(1100px, 90vw); border: 0; border-radius: 12px; padding: 8px 14px;
      color: white; background: rgba(9, 24, 35, .72); box-shadow: 0 4px 18px rgba(0,0,0,.34);
      text-align: center; white-space: pre-line; line-height: 1.3; text-shadow: 0 2px 4px #000;
      font-weight: 650; pointer-events: none; }
    #cue.study { pointer-events: auto; cursor: pointer; outline: 2px solid rgba(88, 204, 180, .8); }
    #cue.selected { background: rgba(17, 94, 89, .88); outline-color: #f5c96a; }
    #badge { position: absolute; top: -25px; left: 50%; transform: translateX(-50%); color: #d8fff5;
      font: 600 12px/1.2 Inter, Segoe UI, sans-serif; background: rgba(8, 47, 52, .9);
      border-radius: 999px; padding: 4px 9px; white-space: nowrap; }
  `;
  const line = document.createElement("div");
  line.id = "line";
  const cueButton = document.createElement("button");
  cueButton.id = "cue";
  cueButton.type = "button";
  const badge = document.createElement("span");
  badge.id = "badge";
  badge.hidden = true;
  cueButton.append(badge, document.createTextNode(""));
  line.append(cueButton);
  shadow.append(style, line);
  (document.documentElement || document.body).append(host);

  cueButton.addEventListener("click", () => {
    if (settings.mode !== "study") {
      return;
    }
    const video = mainVideo();
    const active = video ? core.activeCueIndices(cues, video.currentTime, settings.offsetSeconds) : [];
    for (const index of active) {
      selections.has(index) ? selections.delete(index) : selections.add(index);
    }
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
        cues = core.normalizeCues(message.cues);
        trackId = String(message.trackId || "");
        trackLabel = String(message.label || "Authorized subtitle");
        selections = await loadSelections(trackId);
        renderedKey = "";
        return { cueCount: cues.length };
      case "CLEAR_AUTHORIZED_TRACK":
        cues = [];
        trackId = "";
        trackLabel = "";
        selections = new Set();
        playlist = null;
        renderedKey = "";
        return {};
      case "SET_CUSTOMER_SETTINGS":
        settings = sanitizeSettings({ ...settings, ...message.settings });
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        renderedKey = "";
        return { settings };
      case "PLAY_STUDY_SELECTIONS":
        startPlaylist();
        return { selectedCount: selections.size };
      case "GET_CUSTOMER_STATE": {
        const video = mainVideo();
        return {
          trackId,
          trackLabel,
          cueCount: cues.length,
          selectedCount: selections.size,
          videoDetected: Boolean(video),
          videoIdentity: core.pageVideoIdentity(location.href),
          settings
        };
      }
      default:
        return {};
    }
  }

  function sanitizeSettings(candidate) {
    return {
      mode: candidate.mode === "study" ? "study" : "watch",
      visible: candidate.visible !== false,
      offsetSeconds: clamp(Number(candidate.offsetSeconds), -30, 30, 0),
      fontSizePx: clamp(Number(candidate.fontSizePx), 18, 72, 38),
      bottomPercent: clamp(Number(candidate.bottomPercent), 2, 45, 10),
      repeatCount: Math.round(clamp(Number(candidate.repeatCount), 1, 20, 5))
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

  function area(video) {
    const rect = video.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function render() {
    const video = mainVideo();
    const active = video && cues.length
      ? core.activeCueIndices(cues, video.currentTime, settings.offsetSeconds)
      : [];
    advancePlaylist(video);
    const key = [settings.visible, settings.mode, settings.fontSizePx, settings.bottomPercent, active.join(","), [...selections].join(",")].join("|");
    if (key === renderedKey) {
      return;
    }
    renderedKey = key;
    line.style.bottom = `${settings.bottomPercent}%`;
    cueButton.style.fontSize = `${settings.fontSizePx}px`;
    const text = active.map((index) => cues[index]?.text).filter(Boolean).join("\n");
    cueButton.lastChild.nodeValue = text;
    cueButton.hidden = !settings.visible || !text;
    cueButton.className = settings.mode === "study" ? "study" : "";
    const selected = active.some((index) => selections.has(index));
    cueButton.classList.toggle("selected", selected);
    badge.hidden = settings.mode !== "study";
    badge.textContent = selected ? "Saved for study" : "Click to save";
  }

  function startPlaylist() {
    const indices = [...selections].sort((a, b) => a - b);
    if (!indices.length || !mainVideo()) {
      throw new Error("Save at least one subtitle in Study mode first.");
    }
    playlist = { indices, position: 0, repeatsLeft: settings.repeatCount };
    playPlaylistCue();
  }

  function playPlaylistCue() {
    const video = mainVideo();
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
    if (!playlist || !video) {
      return;
    }
    const cue = cues[playlist.indices[playlist.position]];
    if (!cue) {
      playlist = null;
      return;
    }
    const bounds = core.playbackBounds(cue, settings.offsetSeconds);
    if (video.currentTime < bounds.end) {
      return;
    }
    if (playlist.repeatsLeft > 1) {
      playlist.repeatsLeft -= 1;
      playPlaylistCue();
      return;
    }
    playlist.position += 1;
    if (playlist.position >= playlist.indices.length) {
      playlist = null;
      return;
    }
    playlist.repeatsLeft = settings.repeatCount;
    playPlaylistCue();
  }

  async function loadSelections(id) {
    if (!id) {
      return new Set();
    }
    const stored = await chrome.storage.local.get(SELECTIONS_KEY);
    return new Set(stored[SELECTIONS_KEY]?.[id] || []);
  }

  async function saveSelections() {
    if (!trackId) {
      return;
    }
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
