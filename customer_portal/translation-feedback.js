(() => {
  "use strict";

  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  const cueCache = new Map();
  let selectedCue = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    const form = $("reportForm");
    const category = $("reportCategory");
    if (!form || !category || $("translationFeedbackFields")) return;

    ensureStyles();
    buildFields(form);
    category.addEventListener("change", syncMode);
    $("reportTrack").addEventListener("change", resetCuePicker);
    $("translationTime").addEventListener("input", clearSelectedCue);
    $("translationTime").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        showNearbyCues();
      }
    });
    $("showNearbyCues").addEventListener("click", showNearbyCues);
    form.addEventListener("reset", () => setTimeout(() => {
      resetCuePicker();
      syncMode();
    }, 0));
    form.addEventListener("submit", submitTranslationFeedback, true);
    syncMode();
  }

  function ensureStyles() {
    if (document.querySelector('link[data-translation-feedback-styles]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/portal-assets/translation-feedback.css?v=20260819-2";
    link.dataset.translationFeedbackStyles = "true";
    document.head.append(link);
  }

  function buildFields(form) {
    const fields = document.createElement("div");
    fields.id = "translationFeedbackFields";
    fields.className = "translation-feedback-fields";
    fields.hidden = true;
    fields.innerHTML = `
      <div class="translation-feedback-intro">
        <strong>Pick the subtitle line that looks wrong</strong>
        <span>Choose your subtitle above, enter roughly when it appears, then tap the exact line. You do not need to copy any subtitle text.</span>
      </div>

      <div class="translation-time-row">
        <label>Time <span class="field-badge required">Required</span>
          <input id="translationTime" type="text" inputmode="numeric" autocomplete="off" placeholder="12:34 or 1:12:34">
          <span class="field-help">Minutes:seconds or hours:minutes:seconds. Plain seconds also works.</span>
        </label>
        <button id="showNearbyCues" type="button" class="secondary">Show subtitles</button>
      </div>

      <div id="translationCuePicker" class="translation-cue-picker" hidden>
        <div class="translation-cue-picker-heading">
          <strong>Choose the incorrect subtitle</strong>
          <span id="translationCuePickerStatus" class="muted"></span>
        </div>
        <div id="translationCueList" class="translation-cue-list"></div>
      </div>

      <div id="translationSelectedCue" class="translation-selected-cue" hidden>
        <small>Selected subtitle</small>
        <strong id="translationSelectedCueTime"></strong>
        <p id="translationSelectedCueText"></p>
      </div>
      <input id="translationCurrentText" type="hidden">

      <label>Why is the translation wrong? <span class="field-badge required">Required</span>
        <select id="translationIssueReason">
          <option value="wrong_meaning">Wrong meaning</option>
          <option value="unnatural">Awkward / unnatural</option>
          <option value="name_term">Name / terminology</option>
          <option value="context">Context misunderstood</option>
          <option value="grammar">Grammar</option>
          <option value="missing_words">Missing words / detail</option>
          <option value="other">Other</option>
        </select>
      </label>

      <label>What should it say instead? <span class="field-badge optional">Optional</span>
        <textarea id="translationSuggestedText" rows="2" placeholder="Your corrected or more natural version, if you know it"></textarea>
      </label>
    `;

    const messageLabel = $("reportMessage")?.closest("label");
    if (messageLabel) form.insertBefore(fields, messageLabel);
    else form.insertBefore(fields, form.lastElementChild);
  }

  function syncMode() {
    const isTranslation = $("reportCategory")?.value === "translation";
    const fields = $("translationFeedbackFields");
    const track = $("reportTrack");
    const time = $("reportTime");
    const message = $("reportMessage");
    const url = $("reportUrl");
    if (!fields || !track || !time || !message || !url) return;

    fields.hidden = !isTranslation;
    $("translationIssueReason").required = isTranslation;
    track.required = isTranslation;
    time.required = false;
    message.required = !isTranslation;
    url.required = !isTranslation;

    const timeLabel = time.closest("label");
    const urlLabel = url.closest("label");
    if (timeLabel) timeLabel.hidden = isTranslation;
    if (urlLabel) urlLabel.hidden = isTranslation;

    const messageLabel = message.closest("label");
    if (messageLabel?.firstChild) {
      messageLabel.firstChild.nodeValue = isTranslation ? "Extra note (optional)" : "What happened?";
    }
    message.placeholder = isTranslation
      ? "Optional context, e.g. who is speaking or why the wording is misleading"
      : "Tell us what looked wrong";

    if (!isTranslation) resetCuePicker();
  }

  async function showNearbyCues() {
    const status = $("status");
    const trackId = $("reportTrack").value;
    let targetSeconds;

    if (!trackId) {
      status.textContent = "Choose the subtitle you are reporting first.";
      $("reportTrack").focus();
      return;
    }

    try {
      targetSeconds = parseUserTime($("translationTime").value);
    } catch (error) {
      status.textContent = error.message;
      $("translationTime").focus();
      return;
    }

    const picker = $("translationCuePicker");
    const pickerStatus = $("translationCuePickerStatus");
    const list = $("translationCueList");
    picker.hidden = false;
    pickerStatus.textContent = "Loading…";
    list.replaceChildren();
    clearSelectedCue();

    try {
      const cues = await loadTrackCues(trackId);
      const nearby = nearbyCues(cues, targetSeconds, 7);
      pickerStatus.textContent = `Near ${formatClock(targetSeconds)}`;
      for (const cue of nearby) list.append(buildCueButton(cue));
      if (!nearby.length) {
        list.textContent = "No subtitle lines were found near this time.";
      }
      status.textContent = "";
    } catch (error) {
      pickerStatus.textContent = "";
      list.textContent = error.message;
      status.textContent = error.message;
    }
  }

  async function loadTrackCues(trackId) {
    if (cueCache.has(trackId)) return cueCache.get(trackId);

    const metadata = await client.select(
      "subtitle_tracks",
      `select=id,storage_path&id=eq.${encodeURIComponent(trackId)}&limit=1`
    );
    const track = metadata?.[0];
    if (!track) throw new Error("This subtitle is no longer available to your account.");

    let cues;
    if (track.storage_path) {
      const srt = await downloadPrivateSrt(track.storage_path);
      cues = parseSrt(srt);
    } else {
      const legacy = await client.select(
        "subtitle_tracks",
        `select=id,cues&id=eq.${encodeURIComponent(trackId)}&limit=1`
      );
      cues = normalizeLegacyCues(legacy?.[0]?.cues);
    }

    if (!cues.length) throw new Error("No subtitle lines are available for this track.");
    cueCache.set(trackId, cues);
    return cues;
  }

  async function downloadPrivateSrt(storagePath) {
    const session = await client.validSession();
    if (!session?.access_token) throw new Error("Please sign in again.");
    const objectPath = String(storagePath).split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `${client.baseUrl}/storage/v1/object/authenticated/subtitle-files/${objectPath}`,
      {headers:client.headers(session.access_token)}
    );
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        const value = JSON.parse(text);
        message = value.message || value.error || text;
      } catch {
        // Keep the plain response text.
      }
      throw new Error(message || "The subtitle file could not be loaded.");
    }
    return response.text();
  }

  function parseSrt(raw) {
    const cues = [];
    const normalized = String(raw || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .trim();
    for (const block of normalized.split(/\n{2,}/)) {
      const lines = block.split("\n");
      const timelineIndex = lines.findIndex((line) => line.includes("-->"));
      if (timelineIndex < 0) continue;
      const match = lines[timelineIndex].match(
        /^(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})\s*-->\s*(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})/
      );
      const text = lines.slice(timelineIndex + 1).join("\n").trim();
      if (!match || !text) continue;
      const start = srtTimeToSeconds(match[1]);
      const end = srtTimeToSeconds(match[2]);
      if (end > start) cues.push({start, end, text});
    }
    return cues;
  }

  function normalizeLegacyCues(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map((cue) => ({
        start: Number(cue?.start),
        end: Number(cue?.end),
        text: String(cue?.text || "").trim(),
      }))
      .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text);
  }

  function nearbyCues(cues, targetSeconds, count) {
    if (!cues.length) return [];
    let closestIndex = 0;
    let closestDistance = Infinity;
    cues.forEach((cue, index) => {
      const distance = targetSeconds < cue.start
        ? cue.start - targetSeconds
        : targetSeconds > cue.end
          ? targetSeconds - cue.end
          : 0;
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    const half = Math.floor(count / 2);
    let start = Math.max(0, closestIndex - half);
    let end = Math.min(cues.length, start + count);
    start = Math.max(0, end - count);
    return cues.slice(start, end);
  }

  function buildCueButton(cue) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "translation-cue-option";
    button.dataset.cueStart = String(cue.start);

    const time = document.createElement("span");
    time.className = "translation-cue-time";
    time.textContent = formatClock(cue.start);
    const text = document.createElement("span");
    text.className = "translation-cue-text";
    text.textContent = cue.text;
    button.append(time, text);
    button.addEventListener("click", () => selectCue(cue, button));
    return button;
  }

  function selectCue(cue, button) {
    selectedCue = cue;
    $("translationCurrentText").value = cue.text;
    $("reportTime").value = String(cue.start);
    $("translationSelectedCueTime").textContent = formatClock(cue.start);
    $("translationSelectedCueText").textContent = cue.text;
    $("translationSelectedCue").hidden = false;
    document.querySelectorAll(".translation-cue-option").forEach((item) =>
      item.classList.toggle("selected", item === button)
    );
    $("status").textContent = "Subtitle selected. Add a correction if you know one, then send the report.";
  }

  function clearSelectedCue() {
    selectedCue = null;
    if ($("translationCurrentText")) $("translationCurrentText").value = "";
    if ($("reportTime") && $("reportCategory")?.value === "translation") $("reportTime").value = "";
    if ($("translationSelectedCue")) $("translationSelectedCue").hidden = true;
    document.querySelectorAll(".translation-cue-option").forEach((item) => item.classList.remove("selected"));
  }

  function resetCuePicker() {
    clearSelectedCue();
    const picker = $("translationCuePicker");
    const list = $("translationCueList");
    if (picker) picker.hidden = true;
    if (list) list.replaceChildren();
    if ($("translationCuePickerStatus")) $("translationCuePickerStatus").textContent = "";
  }

  function parseUserTime(raw) {
    const value = String(raw || "").trim();
    if (!value) throw new Error("Enter the approximate subtitle time, for example 12:34.");
    if (/^\d+(?:\.\d+)?$/.test(value)) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    }

    const parts = value.split(":");
    if (parts.length === 2 || parts.length === 3) {
      const numbers = parts.map(Number);
      if (numbers.every(Number.isFinite) && numbers.every((number) => number >= 0)) {
        if (parts.length === 2 && numbers[1] < 60) return numbers[0] * 60 + numbers[1];
        if (parts.length === 3 && numbers[1] < 60 && numbers[2] < 60) {
          return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
        }
      }
    }
    throw new Error("Use a time like 12:34, 1:12:34, or plain seconds.");
  }

  function srtTimeToSeconds(value) {
    const [hours, minutes, tail] = value.replace(",", ".").split(":");
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(tail);
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
      : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  async function submitTranslationFeedback(event) {
    if ($("reportCategory")?.value !== "translation") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const form = event.currentTarget;
    const status = $("status");
    const trackId = $("reportTrack").value;

    if (!trackId) {
      status.textContent = "Choose the subtitle that contains the mistranslation.";
      $("reportTrack").focus();
      return;
    }
    if (!selectedCue || !$("translationCurrentText").value.trim()) {
      status.textContent = "Enter the time, show nearby subtitles, and choose the incorrect line.";
      $("translationTime").focus();
      return;
    }

    try {
      status.textContent = "Sending translation feedback…";
      await client.rpc("submit_translation_feedback", {
        p_subtitle_track_id: trackId,
        p_video_url: $("reportUrl").value.trim(),
        p_cue_time_seconds: selectedCue.start,
        p_issue_reason: $("translationIssueReason").value,
        p_current_text: selectedCue.text,
        p_suggested_text: $("translationSuggestedText").value.trim(),
        p_message: $("reportMessage").value.trim(),
        p_source_surface: "web",
      });
      form.reset();
      resetCuePicker();
      syncMode();
      status.textContent = "Translation feedback sent. The exact subtitle line and timestamp were saved automatically.";
    } catch (error) {
      status.textContent = error.message;
    }
  }
})();
