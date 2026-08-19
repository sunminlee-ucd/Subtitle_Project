(() => {
  "use strict";

  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  let user = null;
  let languageHelpTimer = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bind();
    $("setupNotice").hidden = client.isConfigured();
    const params = new URLSearchParams(location.search);
    const video = params.get("video") || "";
    $("requestUrl").value = video;
    $("reportUrl").value = video;
    const session = client.isConfigured() ? await client.validSession() : null;
    await setSession(session);
    showView(params.get("view") || "request");
  }

  function bind() {
    $("signIn").addEventListener("click", signIn);
    $("signUp").addEventListener("click", signUp);
    $("signOut").addEventListener("click", signOut);
    $("requestForm").addEventListener("submit", submitRequest);
    $("reportForm").addEventListener("submit", submitReport);
    $("languageHelpButton").addEventListener("click", showLanguageHelp);
    $("requestSeason").addEventListener("blur", () => normalizeCodeField($("requestSeason"), "S"));
    $("requestEpisode").addEventListener("blur", () => normalizeCodeField($("requestEpisode"), "E"));
    document.querySelectorAll("[data-view]").forEach((button) =>
      button.addEventListener("click", () => showView(button.dataset.view))
    );
  }

  async function signIn() {
    try {
      await setSession(await client.signIn($("email").value.trim(), $("password").value));
      $("authStatus").textContent = "";
    } catch (error) {
      $("authStatus").textContent = error.message;
    }
  }

  async function signUp() {
    try {
      const result = await client.signUp($("email").value.trim(), $("password").value);
      $("authStatus").textContent = result.access_token
        ? "Account created. You can sign in now."
        : "Check your email to confirm the account, then sign in.";
    } catch (error) {
      $("authStatus").textContent = error.message;
    }
  }

  async function signOut() {
    await client.signOut();
    await setSession(null);
  }

  async function setSession(session) {
    user = session?.user || null;
    $("auth").hidden = Boolean(user);
    $("workspace").hidden = !user;
    $("userEmail").textContent = user?.email || "";
    if (user) await Promise.all([loadTracks(), loadRequests()]);
  }

  async function loadTracks() {
    try {
      const tracks = await client.select(
        "subtitle_tracks",
        "select=id,language_name,label,cue_count,updated_at,video:videos(title,episode_label,provider)&is_active=eq.true&order=updated_at.desc"
      );
      renderAuthorizedTracks(tracks || []);
      const select = $("reportTrack");
      select.replaceChildren(new Option("Not sure / general issue", ""));
      for (const track of tracks || []) {
        const video = Array.isArray(track.video) ? track.video[0] : track.video;
        select.add(
          new Option(
            `${video?.title || "Untitled"} ${video?.episode_label || ""} · ${track.language_name}`,
            track.id
          )
        );
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  function renderAuthorizedTracks(tracks) {
    const list = $("subtitles");
    list.replaceChildren();
    for (const track of tracks) {
      const video = Array.isArray(track.video) ? track.video[0] : track.video;
      const card = document.createElement("article");
      card.className = "list-item subtitle-access-item";
      const title = document.createElement("strong");
      title.textContent = `${video?.title || "Untitled"}${video?.episode_label ? ` · ${video.episode_label}` : ""}`;
      const detail = document.createElement("p");
      detail.textContent = `${providerLabel(video?.provider)} · ${track.language_name} · ${track.label}`;
      const meta = document.createElement("small");
      meta.className = "muted";
      meta.textContent = `Available in your authorized Android app and Chrome extension · ${track.cue_count} subtitle lines`;
      const badge = document.createElement("span");
      badge.className = "status-badge status-complete";
      badge.textContent = "Available";
      card.append(title, detail, meta, badge);
      list.append(card);
    }
    if (!tracks.length) {
      list.textContent = "No subtitles are available to your account yet.";
    }
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    normalizeCodeField($("requestSeason"), "S");
    normalizeCodeField($("requestEpisode"), "E");
    try {
      const title = $("requestTitle").value.trim();
      const season = $("requestSeason").value.trim();
      const episode = $("requestEpisode").value.trim();
      const notes = serializeRequestDetails({
        title,
        season,
        episode,
        notes: $("requestNotes").value.trim(),
      });
      await client.insert("video_requests", {
        customer_id: user.id,
        provider: $("requestProvider").value,
        video_url: $("requestUrl").value.trim(),
        requested_language: $("requestLanguage").value.trim(),
        notes,
      });
      form.reset();
      setStatus("Your request was sent. You can follow its status in My requests.");
      await loadRequests();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const time = $("reportTime").value;
      await client.insert("error_reports", {
        customer_id: user.id,
        subtitle_track_id: $("reportTrack").value || null,
        video_url: $("reportUrl").value.trim(),
        category: $("reportCategory").value,
        message: $("reportMessage").value.trim(),
        cue_time_seconds: time ? Number(time) : null,
      });
      form.reset();
      setStatus("Your report was sent. We will review it.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadRequests() {
    try {
      const requests = await client.select(
        "video_requests",
        "select=id,provider,video_url,requested_language,notes,status,created_at&order=created_at.desc&limit=50"
      );
      const list = $("requestsHistory");
      list.replaceChildren();
      for (const row of requests || []) {
        const details = parseRequestDetails(row.notes);
        const location = [details.season, details.episode].filter(Boolean).join(" · ");
        const card = document.createElement("article");
        card.className = "list-item request-history-item";
        const title = document.createElement("strong");
        title.textContent = `${details.title || "Video request"} · ${row.requested_language}`;
        const detail = document.createElement("p");
        detail.textContent = [providerLabel(row.provider), location].filter(Boolean).join(" · ");
        const meta = document.createElement("small");
        meta.className = "muted";
        meta.textContent = new Date(row.created_at).toLocaleString();
        const status = document.createElement("span");
        const visible = customerRequestStatus(row.status);
        status.className = `status-badge ${visible.className}`;
        status.textContent = visible.label;
        card.append(title, detail, meta, status);
        list.append(card);
      }
      if (!requests?.length) list.textContent = "You have not requested any subtitles yet.";
    } catch (error) {
      setStatus(error.message);
    }
  }

  function customerRequestStatus(status) {
    if (status === "reviewing") return { label: "Pending", className: "status-pending" };
    if (status === "completed") return { label: "Complete", className: "status-complete" };
    if (status === "declined") return { label: "Declined", className: "status-declined" };
    return { label: "Submitted", className: "status-submitted" };
  }

  function showLanguageHelp() {
    const button = $("languageHelpButton");
    const help = $("languageHelpText");
    clearTimeout(languageHelpTimer);
    help.hidden = false;
    button.setAttribute("aria-expanded", "true");
    languageHelpTimer = setTimeout(() => {
      help.hidden = true;
      button.setAttribute("aria-expanded", "false");
      languageHelpTimer = null;
    }, 3000);
  }

  function normalizeCodeField(input, prefix) {
    const value = input.value.trim().toUpperCase().replace(/\s+/g, "");
    if (!value) {
      input.value = "";
      return;
    }
    input.value = /^\d+$/.test(value) ? `${prefix}${value}` : value;
  }

  function serializeRequestDetails({ title, season, episode, notes }) {
    return [
      `Title: ${title}`,
      season ? `Season: ${season}` : "",
      episode ? `Episode: ${episode}` : "",
      notes ? `Notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function parseRequestDetails(raw) {
    const details = { title: "", season: "", episode: "", notes: "" };
    for (const line of String(raw || "").split(/\r?\n/)) {
      const match = line.match(/^(Title|Season|Episode|Notes):\s*(.*)$/i);
      if (!match) continue;
      details[match[1].toLowerCase()] = match[2].trim();
    }
    return details;
  }

  function providerLabel(provider) {
    if (provider === "netflix") return "Netflix";
    if (provider === "disney") return "Disney+";
    if (provider === "youtube") return "YouTube";
    return "Other";
  }

  function showView(name) {
    const allowed = ["request", "report", "requests", "subtitles"];
    const selected = allowed.includes(name) ? name : "request";
    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = view.id !== `${selected}View`;
    });
    document.querySelectorAll("[data-view]").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === selected)
    );
    const params = new URLSearchParams(location.search);
    params.set("view", selected);
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }

  function setStatus(message) {
    $("status").textContent = message;
  }
})();
