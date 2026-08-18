(() => {
  "use strict";
  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  let user = null;

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
      const result = await client.signUp(
        $("email").value.trim(),
        $("password").value,
        $("displayName").value.trim()
      );
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
    if (user) await Promise.all([loadTracks(), loadHistory()]);
  }

  async function loadTracks() {
    try {
      const tracks = await client.select(
        "subtitle_tracks",
        "select=id,language_name,label,video:videos(title,episode_label)&is_active=eq.true&order=updated_at.desc"
      );
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
      setStatus("Your request was sent. We’ll keep it in My history for you.");
      await loadHistory();
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
      await loadHistory();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadHistory() {
    try {
      const [requests, reports] = await Promise.all([
        client.select(
          "video_requests",
          "select=id,provider,video_url,requested_language,notes,status,created_at&order=created_at.desc&limit=20"
        ),
        client.select(
          "error_reports",
          "select=id,category,message,status,created_at&order=created_at.desc&limit=20"
        ),
      ]);
      const list = $("history");
      list.replaceChildren();
      const items = [
        ...(requests || []).map((row) => {
          const details = parseRequestDetails(row.notes);
          const location = [details.season, details.episode].filter(Boolean).join(" · ");
          const provider = providerLabel(row.provider);
          return {
            date: row.created_at,
            title: `${details.title || "Video request"} · ${row.requested_language}`,
            detail: [provider, location, row.video_url ? "Streaming link included" : "Title-based request"]
              .filter(Boolean)
              .join(" · "),
            status: row.status,
          };
        }),
        ...(reports || []).map((row) => ({
          date: row.created_at,
          title: `Issue · ${row.category}`,
          detail: row.message,
          status: row.status,
        })),
      ].sort((a, b) => new Date(b.date) - new Date(a.date));

      for (const item of items) {
        const card = document.createElement("article");
        card.className = "list-item";
        const title = document.createElement("strong");
        title.textContent = item.title;
        const detail = document.createElement("p");
        detail.textContent = item.detail;
        const meta = document.createElement("small");
        meta.className = "muted";
        meta.textContent = `${item.status} · ${new Date(item.date).toLocaleString()}`;
        card.append(title, detail, meta);
        list.append(card);
      }
      if (!items.length) list.textContent = "No requests or reports yet.";
    } catch (error) {
      setStatus(error.message);
    }
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
    const selected = ["request", "report", "history"].includes(name) ? name : "request";
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
