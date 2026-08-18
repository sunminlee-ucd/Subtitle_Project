(() => {
  "use strict";
  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  let user = null;
  let manualMode = false;
  let selectedCatalog = null;
  let selectedSeason = null;
  let selectedEpisode = null;
  let catalogAbortController = null;
  let catalogSearchTimer = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bind();
    $("setupNotice").hidden = client.isConfigured();
    const params = new URLSearchParams(location.search);
    const video = params.get("video") || "";
    $("requestUrl").value = video;
    $("reportUrl").value = video;
    setRequestMode();
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
    $("requestProvider").addEventListener("change", handleProviderChange);
    $("catalogSearchButton").addEventListener("click", searchCatalog);
    $("requestCatalogQuery").addEventListener("input", scheduleCatalogSearch);
    $("requestCatalogQuery").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      searchCatalog();
    });
    $("changeCatalogTitle").addEventListener("click", clearCatalogSelection);
    $("requestSeasonSelect").addEventListener("change", loadEpisodesForSelectedSeason);
    $("manualRequestToggle").addEventListener("click", showManualRequest);
    $("returnToCatalog").addEventListener("click", showCatalogRequest);
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

  function handleProviderChange() {
    manualMode = false;
    resetCatalogState();
    setRequestMode();
    if (catalogEnabled()) {
      $("requestCatalogQuery").focus();
    }
  }

  function setRequestMode() {
    const useCatalog = catalogEnabled() && !manualMode;
    $("catalogRequestFields").hidden = !useCatalog;
    $("manualRequestFields").hidden = useCatalog;
    $("returnToCatalog").hidden = !catalogEnabled();
    if (!catalogEnabled()) {
      manualMode = true;
      $("manualRequestFields").hidden = false;
    }
  }

  function catalogEnabled() {
    return ["netflix", "disney"].includes($("requestProvider").value);
  }

  function scheduleCatalogSearch() {
    window.clearTimeout(catalogSearchTimer);
    const query = $("requestCatalogQuery").value.trim();
    if (query.length < 2) {
      setCatalogStatus("");
      $("catalogResults").replaceChildren();
      return;
    }
    catalogSearchTimer = window.setTimeout(searchCatalog, 450);
  }

  async function searchCatalog() {
    if (!catalogEnabled()) return;
    const query = $("requestCatalogQuery").value.trim();
    if (query.length < 2) {
      setCatalogStatus("Enter at least 2 characters to search.", true);
      return;
    }
    if (catalogAbortController) catalogAbortController.abort();
    catalogAbortController = new AbortController();
    resetCatalogState({ keepQuery: true });
    const provider = $("requestProvider").value;
    setCatalogStatus(`Searching ${providerLabel(provider)} in Ireland…`);
    try {
      const data = await fetchCatalogJson(
        `/api/catalog/search?q=${encodeURIComponent(query)}&provider=${encodeURIComponent(provider)}`,
        catalogAbortController.signal
      );
      renderCatalogResults(data.results || []);
      setCatalogStatus(
        data.results?.length
          ? `Choose the matching title from ${data.results.length} result${data.results.length === 1 ? "" : "s"}.`
          : `No matching ${providerLabel(provider)} titles were found in Ireland. You can enter it manually.`,
        !data.results?.length
      );
    } catch (error) {
      if (error.name === "AbortError") return;
      setCatalogStatus(error.message, true);
      if (/not configured/i.test(error.message)) {
        showManualRequest();
        setStatus("Catalogue search is not configured on the server yet. Manual title entry is available.");
      }
    }
  }

  function renderCatalogResults(results) {
    const container = $("catalogResults");
    container.replaceChildren();
    for (const result of results) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "catalog-result";
      card.setAttribute("aria-label", `Select ${result.title}`);

      const poster = createImageBox("catalog-result-poster", result.poster_url, result.title, "No poster");
      const copy = document.createElement("div");
      copy.className = "catalog-result-copy";
      const title = document.createElement("strong");
      title.textContent = result.title;
      const meta = document.createElement("span");
      meta.textContent = [result.media_type === "tv" ? "TV series" : "Movie", result.year]
        .filter(Boolean)
        .join(" · ");
      copy.append(title, meta);
      if (result.overview) {
        const overview = document.createElement("p");
        overview.textContent = result.overview;
        copy.append(overview);
      }
      card.append(poster, copy);
      card.addEventListener("click", () => selectCatalogResult(result));
      container.append(card);
    }
  }

  async function selectCatalogResult(result) {
    selectedCatalog = result;
    selectedSeason = null;
    selectedEpisode = null;
    $("catalogResults").replaceChildren();
    $("requestCatalogQuery").value = result.title;
    renderSelectedCatalog();
    setCatalogStatus("");
    if (result.media_type === "tv") {
      $("tvSelection").hidden = false;
      await loadSeasons(result.id);
    } else {
      $("tvSelection").hidden = true;
    }
  }

  function renderSelectedCatalog() {
    const card = $("selectedCatalog");
    card.hidden = !selectedCatalog;
    if (!selectedCatalog) return;
    const poster = $("selectedCatalogPoster");
    poster.replaceChildren();
    const imageBox = createImageBox(
      "selected-catalog-image",
      selectedCatalog.poster_url,
      selectedCatalog.title,
      "No poster"
    );
    while (imageBox.firstChild) poster.append(imageBox.firstChild);
    $("selectedCatalogTitle").textContent = selectedCatalog.title;
    $("selectedCatalogMeta").textContent = [
      selectedCatalog.media_type === "tv" ? "TV series" : "Movie",
      selectedCatalog.year,
      `${providerLabel($("requestProvider").value)} · Ireland`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function loadSeasons(seriesId) {
    const select = $("requestSeasonSelect");
    select.replaceChildren(new Option("Loading seasons…", ""));
    select.disabled = true;
    $("episodeResults").replaceChildren();
    try {
      const data = await fetchCatalogJson(`/api/catalog/tv/${seriesId}`);
      select.replaceChildren(new Option("Choose a season", ""));
      for (const season of data.seasons || []) {
        const label = `S${season.season_number} · ${season.name}${
          season.episode_count ? ` · ${season.episode_count} episodes` : ""
        }`;
        select.add(new Option(label, String(season.season_number)));
      }
      if (!(data.seasons || []).length) {
        setCatalogStatus("No regular seasons were returned for this title. You can use manual entry.", true);
      }
    } catch (error) {
      select.replaceChildren(new Option("Unable to load seasons", ""));
      setCatalogStatus(error.message, true);
    } finally {
      select.disabled = false;
    }
  }

  async function loadEpisodesForSelectedSeason() {
    const seasonNumber = Number($("requestSeasonSelect").value);
    selectedSeason = seasonNumber > 0 ? seasonNumber : null;
    selectedEpisode = null;
    updateEpisodeSelectionLabel();
    const container = $("episodeResults");
    container.replaceChildren();
    if (!selectedCatalog || !selectedSeason) return;

    const loading = document.createElement("p");
    loading.className = "catalog-status";
    loading.textContent = "Loading episodes…";
    container.append(loading);
    try {
      const data = await fetchCatalogJson(
        `/api/catalog/tv/${selectedCatalog.id}/season/${selectedSeason}`
      );
      renderEpisodes(data.episodes || []);
      if (!(data.episodes || []).length) {
        setCatalogStatus("No episodes were returned for this season. You can use manual entry.", true);
      } else {
        setCatalogStatus("Choose the exact episode below.");
      }
    } catch (error) {
      container.replaceChildren();
      setCatalogStatus(error.message, true);
    }
  }

  function renderEpisodes(episodes) {
    const container = $("episodeResults");
    container.replaceChildren();
    for (const episode of episodes) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "episode-card";
      card.setAttribute("aria-label", `Select E${episode.episode_number} ${episode.name}`);
      const still = createImageBox(
        "episode-still",
        episode.still_url,
        `E${episode.episode_number} ${episode.name}`,
        `E${episode.episode_number}`
      );
      const copy = document.createElement("div");
      copy.className = "episode-copy";
      const title = document.createElement("strong");
      title.textContent = `E${episode.episode_number} · ${episode.name}`;
      const meta = document.createElement("span");
      meta.textContent = episode.air_date || `Season ${selectedSeason}`;
      copy.append(title, meta);
      if (episode.overview) {
        const overview = document.createElement("p");
        overview.textContent = episode.overview;
        copy.append(overview);
      }
      card.append(still, copy);
      card.addEventListener("click", () => {
        selectedEpisode = episode;
        container.querySelectorAll(".episode-card").forEach((item) => item.classList.remove("active"));
        card.classList.add("active");
        updateEpisodeSelectionLabel();
        setCatalogStatus("");
      });
      container.append(card);
    }
  }

  function updateEpisodeSelectionLabel() {
    const label = $("episodeSelectionLabel");
    if (!selectedEpisode) {
      label.hidden = true;
      label.textContent = "";
      return;
    }
    label.hidden = false;
    label.textContent = `Selected · S${selectedSeason} E${selectedEpisode.episode_number}`;
  }

  function clearCatalogSelection() {
    resetCatalogState({ keepQuery: true });
    $("requestCatalogQuery").select();
    setCatalogStatus("Search again and choose the correct title.");
  }

  function resetCatalogState({ keepQuery = false } = {}) {
    selectedCatalog = null;
    selectedSeason = null;
    selectedEpisode = null;
    if (!keepQuery) $("requestCatalogQuery").value = "";
    $("catalogResults").replaceChildren();
    $("selectedCatalog").hidden = true;
    $("selectedCatalogPoster").replaceChildren();
    $("tvSelection").hidden = true;
    $("requestSeasonSelect").replaceChildren(new Option("Choose a season", ""));
    $("episodeResults").replaceChildren();
    updateEpisodeSelectionLabel();
    setCatalogStatus("");
  }

  function showManualRequest() {
    manualMode = true;
    resetCatalogState({ keepQuery: true });
    setRequestMode();
    if ($("requestCatalogQuery").value.trim() && !$("requestTitle").value.trim()) {
      $("requestTitle").value = $("requestCatalogQuery").value.trim();
    }
    $("requestTitle").focus();
  }

  function showCatalogRequest() {
    if (!catalogEnabled()) return;
    manualMode = false;
    setRequestMode();
    $("requestCatalogQuery").focus();
  }

  async function fetchCatalogJson(url, signal = undefined) {
    const response = await fetch(url, { signal, cache: "no-store", headers: { Accept: "application/json" } });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(payload?.detail || "Catalogue search is temporarily unavailable.");
    }
    return payload;
  }

  function createImageBox(className, url, alt, fallbackText) {
    const box = document.createElement("div");
    box.className = className;
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = alt;
      image.loading = "lazy";
      image.decoding = "async";
      box.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "catalog-image-placeholder";
      placeholder.textContent = fallbackText;
      box.append(placeholder);
    }
    return box;
  }

  async function submitRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const details = requestDetailsForSubmission();
      if (!details.title) throw new Error("Choose a title or enter one manually.");
      if (details.mediaType === "tv" && (!details.season || !details.episode)) {
        throw new Error("Choose both a season and an episode for a TV series.");
      }
      const notes = serializeRequestDetails({
        ...details,
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
      manualMode = false;
      resetCatalogState();
      setRequestMode();
      setStatus("Your request was sent. We’ll keep it in My history for you.");
      await loadHistory();
    } catch (error) {
      setStatus(error.message);
    }
  }

  function requestDetailsForSubmission() {
    if (catalogEnabled() && !manualMode) {
      if (!selectedCatalog) return { title: "" };
      return {
        title: selectedCatalog.title,
        catalog: "TMDB",
        tmdbId: String(selectedCatalog.id),
        mediaType: selectedCatalog.media_type,
        year: selectedCatalog.year || "",
        season: selectedCatalog.media_type === "tv" && selectedSeason ? `S${selectedSeason}` : "",
        episode:
          selectedCatalog.media_type === "tv" && selectedEpisode
            ? `E${selectedEpisode.episode_number}`
            : "",
        episodeTitle: selectedEpisode?.name || "",
      };
    }
    normalizeCodeField($("requestSeason"), "S");
    normalizeCodeField($("requestEpisode"), "E");
    return {
      title: $("requestTitle").value.trim(),
      catalog: "Manual",
      tmdbId: "",
      mediaType: "",
      year: "",
      season: $("requestSeason").value.trim(),
      episode: $("requestEpisode").value.trim(),
      episodeTitle: "",
    };
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
          const location = [details.season, details.episode, details.episodeTitle]
            .filter(Boolean)
            .join(" · ");
          const provider = providerLabel(row.provider);
          return {
            date: row.created_at,
            title: `${details.title || "Video request"} · ${row.requested_language}`,
            detail: [
              provider,
              location,
              details.catalog === "TMDB" ? "Catalogue selection" : "Manual request",
              row.video_url ? "Share link included" : "",
            ]
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

  function serializeRequestDetails({
    title,
    catalog,
    tmdbId,
    mediaType,
    year,
    season,
    episode,
    episodeTitle,
    notes,
  }) {
    return [
      `Title: ${title}`,
      catalog ? `Catalog: ${catalog}` : "",
      tmdbId ? `TMDB ID: ${tmdbId}` : "",
      mediaType ? `Media type: ${mediaType}` : "",
      year ? `Year: ${year}` : "",
      season ? `Season: ${season}` : "",
      episode ? `Episode: ${episode}` : "",
      episodeTitle ? `Episode title: ${episodeTitle}` : "",
      notes ? `Notes: ${notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function parseRequestDetails(raw) {
    const details = {
      title: "",
      catalog: "",
      tmdbId: "",
      mediaType: "",
      year: "",
      season: "",
      episode: "",
      episodeTitle: "",
      notes: "",
    };
    const keyMap = {
      title: "title",
      catalog: "catalog",
      "tmdb id": "tmdbId",
      "media type": "mediaType",
      year: "year",
      season: "season",
      episode: "episode",
      "episode title": "episodeTitle",
      notes: "notes",
    };
    for (const line of String(raw || "").split(/\r?\n/)) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (!match) continue;
      const key = keyMap[match[1].trim().toLowerCase()];
      if (key) details[key] = match[2].trim();
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

  function setCatalogStatus(message, isError = false) {
    const status = $("catalogStatus");
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function setStatus(message) {
    $("status").textContent = message;
  }
})();
