(() => {
  "use strict";

  const client = new CustomerSupabase.SupabaseRestClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  let currentTab = null;
  let settings = { mode: "watch", visible: true, offsetSeconds: 0, fontSizePx: 38, bottomPercent: 10, repeatCount: 5 };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindEvents();
    $("setupNotice").hidden = client.isConfigured();
    currentTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0] || null;
    await restoreViewerState();
    const session = client.isConfigured() ? await client.validSession() : null;
    setSignedIn(Boolean(session), session?.user?.email || "");
    if (session) {
      await loadTracks();
    }
  }

  function bindEvents() {
    $("signIn").addEventListener("click", signIn);
    $("signOut").addEventListener("click", signOut);
    $("refreshTracks").addEventListener("click", loadTracks);
    $("watchMode").addEventListener("click", () => updateSettings({ mode: "watch" }));
    $("studyMode").addEventListener("click", () => updateSettings({ mode: "study" }));
    $("visible").addEventListener("change", () => updateSettings({ visible: $("visible").checked }));
    for (const [id, key] of [["offset", "offsetSeconds"], ["fontSize", "fontSizePx"], ["bottom", "bottomPercent"], ["repeatCount", "repeatCount"]]) {
      $(id).addEventListener("change", () => updateSettings({ [key]: Number($(id).value) }));
    }
    $("playSelections").addEventListener("click", () => sendToTab({ type: "PLAY_STUDY_SELECTIONS" }).then(showViewerResult));
    $("requestVideo").addEventListener("click", () => openPortal("request"));
    $("reportError").addEventListener("click", () => openPortal("report"));
  }

  async function signIn() {
    setStatus("Signing in…");
    try {
      const session = await client.signIn($("email").value.trim(), $("password").value);
      setSignedIn(true, session.user?.email || $("email").value.trim());
      await loadTracks();
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function signOut() {
    await client.signOut();
    setSignedIn(false, "");
    $("trackList").replaceChildren();
    await chrome.storage.local.remove(["selectedTrackId", "selectedTrackLabel"]);
    await sendToTab({ type: "CLEAR_AUTHORIZED_TRACK" }).catch(() => null);
  }

  function setSignedIn(signedIn, email) {
    $("authCard").hidden = signedIn;
    $("libraryCard").hidden = !signedIn;
    $("viewerCard").hidden = !signedIn;
    $("userEmail").textContent = email;
  }

  async function loadTracks() {
    setStatus("Loading your authorized subtitles…");
    try {
      const rows = await client.select(
        "subtitle_tracks",
        "select=id,language_code,language_name,label,cue_count,video:videos(provider,provider_video_key,title,episode_label)&is_active=eq.true&order=updated_at.desc"
      );
      const stored = await chrome.storage.local.get("selectedTrackId");
      renderTracks(rows || [], stored.selectedTrackId || "");
      const state = await sendToTab({ type: "GET_CUSTOMER_STATE" }).catch(() => null);
      const identity = state?.videoIdentity;
      $("pageContext").textContent = identity?.key
        ? `${identity.provider.toUpperCase()} video detected · ${identity.key}`
        : "Open a supported Netflix, Disney+ or YouTube video.";
      setStatus(rows?.length ? "" : "No subtitles have been shared with this account yet.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  function renderTracks(rows, selectedId) {
    const list = $("trackList");
    list.replaceChildren();
    for (const row of rows) {
      const button = document.createElement("button");
      button.className = `track${row.id === selectedId ? " selected" : ""}`;
      const video = Array.isArray(row.video) ? row.video[0] : row.video;
      const title = document.createElement("span");
      title.textContent = `${video?.title || "Untitled"}${video?.episode_label ? ` · ${video.episode_label}` : ""}`;
      const detail = document.createElement("small");
      detail.textContent = `${row.language_name} · ${row.cue_count} lines`;
      title.append(detail);
      const tag = document.createElement("span");
      tag.textContent = row.language_code.toUpperCase();
      button.append(title, tag);
      button.addEventListener("click", () => selectTrack(row, video, button));
      list.append(button);
    }
  }

  async function selectTrack(track, video, button) {
    setStatus("Preparing subtitles…");
    try {
      const rows = await client.select("subtitle_tracks", `select=id,storage_path,cues&id=eq.${encodeURIComponent(track.id)}&limit=1`);
      if (!rows?.[0]) {
        throw new Error("This subtitle is no longer available.");
      }
      const cues = await loadTrackCues(rows[0]);
      const label = `${video?.title || "Subtitle"} · ${track.language_name}`;
      const result = await sendToTab({ type: "LOAD_AUTHORIZED_TRACK", trackId: track.id, label, cues });
      await chrome.storage.local.set({ selectedTrackId: track.id, selectedTrackLabel: label });
      document.querySelectorAll(".track").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      setStatus(`${result.cueCount} subtitle lines are ready.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadTrackCues(track) {
    if (track.storage_path) {
      const srt = await client.downloadStorageText("subtitle-files", track.storage_path);
      return CustomerSubtitleCore.parseSrt(srt);
    }
    return CustomerSubtitleCore.normalizeCues(track.cues);
  }

  async function restoreViewerState() {
    const stored = await chrome.storage.local.get("customerOverlaySettings");
    settings = { ...settings, ...(stored.customerOverlaySettings || {}) };
    syncControls();
    const state = await sendToTab({ type: "GET_CUSTOMER_STATE" }).catch(() => null);
    showViewerResult(state);
  }

  async function updateSettings(changes) {
    settings = { ...settings, ...changes };
    syncControls();
    const result = await sendToTab({ type: "SET_CUSTOMER_SETTINGS", settings });
    settings = result.settings || settings;
    syncControls();
  }

  function syncControls() {
    $("watchMode").classList.toggle("active", settings.mode !== "study");
    $("studyMode").classList.toggle("active", settings.mode === "study");
    $("visible").checked = settings.visible !== false;
    $("offset").value = settings.offsetSeconds;
    $("fontSize").value = settings.fontSizePx;
    $("bottom").value = settings.bottomPercent;
    $("repeatCount").value = settings.repeatCount;
  }

  function showViewerResult(result) {
    if (!result) {
      $("viewerStatus").textContent = "Open a supported video tab to use the overlay.";
      return;
    }
    $("viewerStatus").textContent = `${result.cueCount || 0} lines loaded · ${result.selectedCount || 0} saved for study`;
  }

  async function sendToTab(message) {
    if (!currentTab?.id) {
      throw new Error("No active browser tab was found.");
    }
    const response = await chrome.tabs.sendMessage(currentTab.id, message);
    if (!response?.ok) {
      throw new Error(response?.error || "Open a supported video and reload the page.");
    }
    return response;
  }

  function openPortal(view) {
    const url = new URL(CUSTOMER_APP_CONFIG.PORTAL_URL);
    url.searchParams.set("view", view);
    if (currentTab?.url) {
      url.searchParams.set("video", currentTab.url);
    }
    chrome.tabs.create({ url: url.href });
  }

  function setStatus(message) {
    $("status").textContent = message;
  }
})();
