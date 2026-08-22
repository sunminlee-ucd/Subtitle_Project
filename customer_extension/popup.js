(() => {
  "use strict";

  const client = new CustomerSupabase.SupabaseRestClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
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

  let currentTab = null;
  let settings = { ...defaults };
  let allTracks = [];
  let selectedTrackId = "";
  let secondaryTrackId = "";
  let liveTimer = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindEvents();
    $("setupNotice").hidden = client.isConfigured();
    currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
    await restoreViewerState();
    const session = client.isConfigured() ? await client.validSession() : null;
    setSignedIn(Boolean(session), session?.user?.email || "");
    if (session) await loadTracks();
    await refreshLiveState();
    liveTimer = setInterval(() => refreshLiveState().catch(() => null), 500);
  }

  function bindEvents() {
    $("signIn").addEventListener("click", signIn);
    $("signOut").addEventListener("click", signOut);
    $("refreshTracks").addEventListener("click", loadTracks);
    $("trackSearch").addEventListener("input", renderTracks);
    $("watchMode").addEventListener("click", () => updateSettings({ mode: "watch" }));
    $("studyMode").addEventListener("click", () => updateSettings({ mode: "study" }));
    $("visible").addEventListener("change", () => updateSettings({ visible: $("visible").checked }));
    $("seekBack").addEventListener("click", () => controlPlayback({ action: "seek", seconds: -5 }));
    $("playPause").addEventListener("click", () => controlPlayback({ action: "toggle" }));
    $("seekForward").addEventListener("click", () => controlPlayback({ action: "seek", seconds: 5 }));
    $("speed").addEventListener("click", cycleSpeed);
    $("syncEarlier").addEventListener("click", () => adjustSetting("offsetSeconds", -0.5, -30, 30));
    $("syncLater").addEventListener("click", () => adjustSetting("offsetSeconds", 0.5, -30, 30));
    $("fontSmaller").addEventListener("click", () => adjustSetting("fontSizePx", -2, 18, 72));
    $("fontLarger").addEventListener("click", () => adjustSetting("fontSizePx", 2, 18, 72));
    $("moveDown").addEventListener("click", () => adjustSetting("bottomPercent", -2, 2, 45));
    $("moveUp").addEventListener("click", () => adjustSetting("bottomPercent", 2, 2, 45));
    $("resetPosition").addEventListener("click", () => updateSettings({ bottomPercent: defaults.bottomPercent }));
    $("secondarySmaller").addEventListener("click", () => adjustSetting("secondaryFontSizePx", -2, 18, 72));
    $("secondaryLarger").addEventListener("click", () => adjustSetting("secondaryFontSizePx", 2, 18, 72));
    $("secondaryDown").addEventListener("click", () => adjustSetting("secondaryBottomPercent", -2, 4, 55));
    $("secondaryUp").addEventListener("click", () => adjustSetting("secondaryBottomPercent", 2, 4, 55));
    $("secondaryReset").addEventListener("click", () => updateSettings({
      secondaryFontSizePx: defaults.secondaryFontSizePx,
      secondaryBottomPercent: defaults.secondaryBottomPercent
    }));
    $("secondaryRemove").addEventListener("click", clearSecondaryTrack);
    $("repeatMinus").addEventListener("click", () => adjustSetting("repeatCount", -1, 1, 20, true));
    $("repeatPlus").addEventListener("click", () => adjustSetting("repeatCount", 1, 1, 20, true));
    $("repeatCurrent").addEventListener("click", () => studyAction("REPEAT_CURRENT"));
    $("playSelections").addEventListener("click", () => studyAction("PLAY_STUDY_SELECTIONS"));
    $("stopStudy").addEventListener("click", () => studyAction("STOP_STUDY_PLAYBACK"));
    $("clearStudy").addEventListener("click", () => studyAction("CLEAR_STUDY_SELECTIONS"));
    $("startMulti").addEventListener("click", startMultiSubtitle);
    $("clearSecondary").addEventListener("click", clearSecondaryTrack);
    $("requestVideo").addEventListener("click", () => openPortal("request"));
    $("reportError").addEventListener("click", () => openPortal("report"));
    window.addEventListener("unload", () => liveTimer && clearInterval(liveTimer));
  }

  async function signIn() {
    setStatus("Signing in...");
    setBusy($("signIn"), true, "Signing in...");
    try {
      const session = await client.signIn($("email").value.trim(), $("password").value);
      setSignedIn(true, session.user?.email || $("email").value.trim());
      $("password").value = "";
      await loadTracks();
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy($("signIn"), false, "Sign in");
    }
  }

  async function signOut() {
    await client.signOut();
    setSignedIn(false, "");
    allTracks = [];
    selectedTrackId = "";
    secondaryTrackId = "";
    $("trackList").replaceChildren();
    await chrome.storage.local.remove(["selectedTrackId", "selectedTrackLabel", "secondaryTrackId", "secondaryTrackLabel"]);
    await sendToTab({ type: "CLEAR_AUTHORIZED_TRACK", slot: "all" }).catch(() => null);
    syncTrackSummary(null);
    renderSecondaryVisibility(false);
  }

  function setSignedIn(signedIn, email) {
    $("authCard").hidden = signedIn;
    $("workspace").hidden = !signedIn;
    $("userEmail").textContent = email;
  }

  async function loadTracks() {
    setStatus("Loading your authorized subtitles...");
    try {
      const rows = await client.select(
        "subtitle_tracks",
        "select=id,language_code,language_name,label,cue_count,updated_at,video:videos(provider,provider_video_key,title,episode_label)&is_active=eq.true&order=updated_at.desc"
      );
      allTracks = rows || [];
      const stored = await chrome.storage.local.get(["selectedTrackId", "secondaryTrackId"]);
      selectedTrackId = allTracks.some((row) => row.id === stored.selectedTrackId) ? stored.selectedTrackId : "";
      secondaryTrackId = allTracks.some((row) => row.id === stored.secondaryTrackId) ? stored.secondaryTrackId : "";
      renderTracks();
      populateMultiSelects();
      await refreshLiveState();
      setStatus(allTracks.length ? "" : "No subtitles have been shared with this account yet.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  function renderTracks() {
    const query = $("trackSearch").value.trim().toLowerCase();
    const filtered = allTracks.filter((row) => trackSearchText(row).includes(query));
    $("libraryCount").textContent = query ? `${filtered.length} of ${allTracks.length}` : `${allTracks.length} available`;
    const list = $("trackList");
    list.replaceChildren();
    for (const row of filtered) {
      const video = videoFor(row);
      const button = document.createElement("button");
      button.className = `track${row.id === selectedTrackId ? " selected" : ""}`;
      const title = document.createElement("span");
      title.textContent = `${video?.title || "Untitled"}${video?.episode_label ? ` · ${video.episode_label}` : ""}`;
      const detail = document.createElement("small");
      detail.textContent = `${providerLabel(video?.provider)} · ${row.language_name} · ${row.cue_count} lines`;
      title.append(detail);
      const tag = document.createElement("span");
      tag.className = "language-tag";
      tag.textContent = String(row.language_code || "sub").toUpperCase();
      button.append(title, tag);
      button.addEventListener("click", () => selectPrimaryTrack(row, button));
      list.append(button);
    }
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = allTracks.length ? "No authorized subtitles match your search." : "Your authorized library is empty.";
      list.append(empty);
    }
  }

  function populateMultiSelects() {
    const primary = $("multiPrimary");
    const secondary = $("multiSecondary");
    primary.replaceChildren(new Option("Choose Sub 1", ""));
    secondary.replaceChildren(new Option("Choose Sub 2", ""));
    for (const row of allTracks) {
      const label = trackDisplayLabel(row);
      primary.add(new Option(label, row.id));
      secondary.add(new Option(label, row.id));
    }
    primary.value = selectedTrackId || "";
    secondary.value = secondaryTrackId || "";
  }

  async function selectPrimaryTrack(track, button) {
    setStatus("Securely loading authorized subtitles...");
    button.disabled = true;
    try {
      const result = await loadTrackIntoSlot(track, "primary");
      await sendToTab({ type: "CLEAR_AUTHORIZED_TRACK", slot: "secondary" }).catch(() => null);
      selectedTrackId = track.id;
      secondaryTrackId = "";
      await chrome.storage.local.set({ selectedTrackId: track.id, selectedTrackLabel: trackDisplayLabel(track) });
      await chrome.storage.local.remove(["secondaryTrackId", "secondaryTrackLabel"]);
      $("multiPrimary").value = track.id;
      $("multiSecondary").value = "";
      renderSecondaryVisibility(false);
      syncTrackSummary(track);
      setStatus(`${result.cueCount} subtitle lines are ready.`);
      await refreshSavedList();
    } catch (error) {
      setStatus(error.message);
    } finally {
      button.disabled = false;
      renderTracks();
    }
  }

  async function startMultiSubtitle() {
    const primaryId = $("multiPrimary").value;
    const secondaryId = $("multiSecondary").value;
    if (!primaryId || !secondaryId) return setStatus("Choose both Sub 1 and Sub 2.");
    if (primaryId === secondaryId) return setStatus("Choose two different authorized subtitles.");
    const primary = allTracks.find((row) => row.id === primaryId);
    const secondary = allTracks.find((row) => row.id === secondaryId);
    if (!primary || !secondary) return setStatus("One of the selected subtitles is no longer available.");
    setBusy($("startMulti"), true, "Loading both...");
    setStatus("Securely loading both authorized subtitles...");
    try {
      const primaryResult = await loadTrackIntoSlot(primary, "primary");
      const secondaryResult = await loadTrackIntoSlot(secondary, "secondary");
      selectedTrackId = primary.id;
      secondaryTrackId = secondary.id;
      await chrome.storage.local.set({
        selectedTrackId: primary.id,
        selectedTrackLabel: trackDisplayLabel(primary),
        secondaryTrackId: secondary.id,
        secondaryTrackLabel: trackDisplayLabel(secondary)
      });
      renderTracks();
      syncTrackSummary(primary, secondary);
      renderSecondaryVisibility(true);
      setStatus(`Multi Subtitle ready · ${primaryResult.cueCount + secondaryResult.cueCount} lines loaded.`);
      await refreshSavedList();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy($("startMulti"), false, "Start Multi Subtitle");
    }
  }

  async function loadTrackIntoSlot(track, slot) {
    const rows = await client.select("subtitle_tracks", `select=id,storage_path,cues&id=eq.${encodeURIComponent(track.id)}&limit=1`);
    if (!rows?.[0]) throw new Error("This subtitle is no longer available to your account.");
    const cues = await loadTrackCues(rows[0]);
    return sendToTab({ type: "LOAD_AUTHORIZED_TRACK", slot, trackId: track.id, label: trackDisplayLabel(track), cues });
  }

  async function loadTrackCues(track) {
    if (track.storage_path) {
      const srt = await client.downloadStorageText("subtitle-files", track.storage_path);
      return CustomerSubtitleCore.parseSrt(srt);
    }
    return CustomerSubtitleCore.normalizeCues(track.cues);
  }

  async function clearSecondaryTrack() {
    await sendToTab({ type: "CLEAR_AUTHORIZED_TRACK", slot: "secondary" }).catch(() => null);
    secondaryTrackId = "";
    await chrome.storage.local.remove(["secondaryTrackId", "secondaryTrackLabel"]);
    $("multiSecondary").value = "";
    renderSecondaryVisibility(false);
    syncTrackSummary(allTracks.find((row) => row.id === selectedTrackId) || null);
    setStatus("Sub 2 removed. Single-subtitle mode is active.");
  }

  async function restoreViewerState() {
    const stored = await chrome.storage.local.get("customerOverlaySettings");
    settings = sanitizeSettings({ ...defaults, ...(stored.customerOverlaySettings || {}) });
    syncControls();
  }

  async function updateSettings(changes) {
    settings = sanitizeSettings({ ...settings, ...changes });
    syncControls();
    try {
      const result = await sendToTab({ type: "SET_CUSTOMER_SETTINGS", settings });
      settings = sanitizeSettings(result.settings || settings);
      syncControls();
      await refreshLiveState(result);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function adjustSetting(key, delta, minimum, maximum, integer = false) {
    let value = Math.min(maximum, Math.max(minimum, Number(settings[key]) + delta));
    if (integer) value = Math.round(value);
    updateSettings({ [key]: value });
  }

  async function controlPlayback(command) {
    try {
      await refreshLiveState(await sendToTab({ type: "CONTROL_PLAYBACK", ...command }));
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function cycleSpeed() {
    const state = await sendToTab({ type: "GET_CUSTOMER_STATE" }).catch(() => null);
    const current = Number(state?.playbackRate || 1);
    const index = SPEEDS.findIndex((value) => Math.abs(value - current) < 0.01);
    await controlPlayback({ action: "speed", rate: SPEEDS[(index + 1 + SPEEDS.length) % SPEEDS.length] });
  }

  async function studyAction(type) {
    try {
      await refreshLiveState(await sendToTab({ type }));
      await refreshSavedList();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function refreshSavedList() {
    const response = await sendToTab({ type: "GET_STUDY_SELECTIONS" }).catch(() => null);
    const items = response?.items || [];
    $("savedCount").textContent = `${items.length} saved`;
    const list = $("savedList");
    list.replaceChildren();
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "saved-item";
      const time = document.createElement("strong");
      time.textContent = `${formatClock(item.start)} - ${formatClock(item.end)}`;
      const text = document.createElement("p");
      text.textContent = item.text;
      const actions = document.createElement("div");
      actions.className = "saved-actions";
      const jump = document.createElement("button");
      jump.textContent = "Play line";
      jump.addEventListener("click", async () => {
        await sendToTab({ type: "JUMP_STUDY_CUE", index: item.index });
        await refreshLiveState();
      });
      const remove = document.createElement("button");
      remove.className = "remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await sendToTab({ type: "REMOVE_STUDY_CUE", index: item.index });
        await refreshSavedList();
        await refreshLiveState();
      });
      actions.append(jump, remove);
      card.append(time, text, actions);
      list.append(card);
    }
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Switch to Study mode and click a subtitle line on the video to save it.";
      list.append(empty);
    }
  }

  async function refreshLiveState(knownState = null) {
    const state = knownState?.videoDetected !== undefined ? knownState : await sendToTab({ type: "GET_CUSTOMER_STATE" }).catch(() => null);
    if (!state) {
      $("syncStatus").textContent = "NO VIDEO";
      $("syncStatus").classList.remove("ready");
      $("positionStatus").textContent = "00:00 / 00:00";
      $("playPause").textContent = "Play";
      $("speed").textContent = "1.0x";
      $("viewerStatus").textContent = "Open a supported Netflix, Disney+ or YouTube video tab.";
      return;
    }
    settings = sanitizeSettings({ ...settings, ...(state.settings || {}) });
    syncControls();
    const identity = state.videoIdentity;
    $("pageContext").textContent = identity?.key ? `${String(identity.provider || "video").toUpperCase()} video detected · ${identity.key}` : "Open a supported Netflix, Disney+ or YouTube video.";
    $("syncStatus").textContent = state.videoDetected ? "VIDEO READY" : "NO VIDEO";
    $("syncStatus").classList.toggle("ready", Boolean(state.videoDetected));
    $("positionStatus").textContent = `${formatClock(state.currentTime || 0)} / ${formatClock(state.duration || 0)}`;
    $("playPause").textContent = state.playing ? "Pause" : "Play";
    $("speed").textContent = `${Number(state.playbackRate || 1).toFixed(2).replace(/0$/, "")}x`;
    $("viewerStatus").textContent = `${state.cueCount || 0} lines loaded · ${state.selectedCount || 0} saved for study`;
    $("trackStatus").textContent = state.trackLabel || "No subtitle loaded";
    renderSecondaryVisibility(Boolean(state.secondaryCueCount));
    if (state.trackId && state.trackId !== selectedTrackId) {
      selectedTrackId = state.trackId;
      renderTracks();
      populateMultiSelects();
    }
    if (state.secondaryTrackId !== undefined) secondaryTrackId = state.secondaryTrackId || "";
    await refreshSavedList();
  }

  function syncControls() {
    $("watchMode").classList.toggle("active", settings.mode !== "study");
    $("studyMode").classList.toggle("active", settings.mode === "study");
    $("visible").checked = settings.visible !== false;
    $("offsetValue").textContent = `${settings.offsetSeconds >= 0 ? "+" : ""}${settings.offsetSeconds.toFixed(1)}s`;
    $("fontValue").textContent = `${settings.fontSizePx}px`;
    $("bottomValue").textContent = `${settings.bottomPercent}%`;
    $("repeatValue").textContent = `${settings.repeatCount}x`;
    $("secondaryFontValue").textContent = `${settings.secondaryFontSizePx}px`;
    $("secondaryBottomValue").textContent = `${settings.secondaryBottomPercent}%`;
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

  function syncTrackSummary(primary, secondary = null) {
    const banner = $("selectedTrack");
    if (!primary) {
      banner.textContent = "No subtitle selected";
      banner.classList.remove("ready");
      return;
    }
    banner.textContent = secondary ? `Selected · ${trackDisplayLabel(primary)} + ${trackDisplayLabel(secondary)}` : `Selected · ${trackDisplayLabel(primary)}`;
    banner.classList.add("ready");
  }

  function renderSecondaryVisibility(visible) { $("secondaryControls").hidden = !visible; }
  function trackSearchText(row) {
    const video = videoFor(row);
    return [video?.title, video?.episode_label, video?.provider, row.language_code, row.language_name, row.label].filter(Boolean).join(" ").toLowerCase();
  }
  function trackDisplayLabel(row) {
    const video = videoFor(row);
    return `${video?.title || "Untitled"}${video?.episode_label ? ` · ${video.episode_label}` : ""} · ${row.language_name}`;
  }
  function videoFor(row) { return Array.isArray(row?.video) ? row.video[0] : row?.video; }
  function providerLabel(provider) {
    if (provider === "netflix") return "Netflix";
    if (provider === "disney") return "Disney+";
    if (provider === "youtube") return "YouTube";
    return "Other";
  }

  async function sendToTab(message) {
    if (!currentTab?.id) throw new Error("No active browser tab was found.");
    const response = await chrome.tabs.sendMessage(currentTab.id, message);
    if (!response?.ok) throw new Error(response?.error || "Open a supported video and reload the page.");
    return response;
  }

  function openPortal(view) {
    const url = new URL(CUSTOMER_APP_CONFIG.PORTAL_URL);
    url.searchParams.set("view", view);
    if (currentTab?.url) url.searchParams.set("video", currentTab.url);
    chrome.tabs.create({ url: url.href });
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function setBusy(button, busy, label = "") {
    if (!button) return;
    button.disabled = busy;
    if (label) button.textContent = label;
  }
  function setStatus(message) { $("status").textContent = message; }
})();
