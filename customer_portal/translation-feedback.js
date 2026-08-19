(() => {
  "use strict";

  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);

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
    form.addEventListener("reset", () => setTimeout(syncMode, 0));
    form.addEventListener("submit", submitTranslationFeedback, true);
    syncMode();
  }

  function ensureStyles() {
    if (document.querySelector('link[data-translation-feedback-styles]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/portal-assets/translation-feedback.css?v=20260819-1";
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
        <strong>Help improve future translations</strong>
        <span>For translation issues, a few structured details are much more useful than a general message.</span>
      </div>
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
      <label>What does the subtitle currently say? <span class="field-badge required">Required</span>
        <textarea id="translationCurrentText" rows="2" placeholder="Copy the subtitle line that looks wrong"></textarea>
      </label>
      <label>What should it say instead? <span class="field-badge optional">Optional</span>
        <textarea id="translationSuggestedText" rows="2" placeholder="Your corrected or more natural version, if you know it"></textarea>
        <span class="field-help">A suggested correction is especially useful for improving translation quality later.</span>
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
    $("translationCurrentText").required = isTranslation;
    track.required = isTranslation;
    time.required = isTranslation;
    message.required = !isTranslation;
    url.required = false;

    const messageLabel = message.closest("label");
    if (messageLabel?.firstChild) {
      messageLabel.firstChild.nodeValue = isTranslation ? "Extra note (optional)" : "What happened?";
    }
    message.placeholder = isTranslation
      ? "Optional context, e.g. who is speaking or why the wording is misleading"
      : "Tell us what looked wrong";

    const timeLabel = time.closest("label");
    if (timeLabel?.firstChild) {
      timeLabel.firstChild.nodeValue = isTranslation
        ? "Approximate subtitle time in seconds"
        : "Approximate time in seconds";
    }
  }

  async function submitTranslationFeedback(event) {
    if ($("reportCategory")?.value !== "translation") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const form = event.currentTarget;
    const status = $("status");
    const trackId = $("reportTrack").value;
    const timeValue = $("reportTime").value.trim();
    const currentText = $("translationCurrentText").value.trim();

    if (!trackId) {
      status.textContent = "Choose the subtitle that contains the mistranslation.";
      $("reportTrack").focus();
      return;
    }
    if (!timeValue || Number(timeValue) < 0) {
      status.textContent = "Enter the approximate subtitle time in seconds.";
      $("reportTime").focus();
      return;
    }
    if (!currentText) {
      status.textContent = "Enter the subtitle text that looks wrong.";
      $("translationCurrentText").focus();
      return;
    }

    try {
      status.textContent = "Sending translation feedback…";
      await client.rpc("submit_translation_feedback", {
        p_subtitle_track_id: trackId,
        p_video_url: $("reportUrl").value.trim(),
        p_cue_time_seconds: Number(timeValue),
        p_issue_reason: $("translationIssueReason").value,
        p_current_text: currentText,
        p_suggested_text: $("translationSuggestedText").value.trim(),
        p_message: $("reportMessage").value.trim(),
        p_source_surface: "web",
      });
      form.reset();
      syncMode();
      status.textContent = "Translation feedback sent. Thank you — it can now be reviewed for future translation improvements.";
    } catch (error) {
      status.textContent = error.message;
    }
  }
})();
