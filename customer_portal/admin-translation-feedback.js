(() => {
  "use strict";

  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  let feedbackRows = [];
  let initialized = false;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    if (initialized) return;
    const reportsView = $("adminReportsView");
    if (!reportsView) return;
    initialized = true;
    ensureStyles();
    buildUi(reportsView);

    document.querySelectorAll('[data-admin-view="reports"]').forEach((button) =>
      button.addEventListener("click", () => loadFeedback())
    );
    $("feedbackStatusFilter").addEventListener("change", renderFeedback);
    $("feedbackReasonFilter").addEventListener("change", renderFeedback);
    $("refreshTranslationFeedback").addEventListener("click", loadFeedback);
    $("exportApprovedFeedback").addEventListener("click", exportApprovedCsv);
  }

  function ensureStyles() {
    if (document.querySelector('link[data-translation-feedback-styles]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/portal-assets/translation-feedback.css?v=20260819-1";
    link.dataset.translationFeedbackStyles = "true";
    document.head.append(link);
  }

  function buildUi(reportsView) {
    const section = document.createElement("section");
    section.className = "admin-translation-feedback";
    section.innerHTML = `
      <div class="translation-feedback-toolbar">
        <div>
          <h3>Translation feedback dataset</h3>
          <p class="muted">Review structured mistranslation reports before using them to improve or evaluate translation quality.</p>
        </div>
        <div class="row">
          <button id="refreshTranslationFeedback" type="button" class="secondary">Refresh</button>
          <button id="exportApprovedFeedback" type="button" class="secondary">Export approved CSV</button>
        </div>
      </div>
      <div class="translation-feedback-filters">
        <select id="feedbackStatusFilter" aria-label="Dataset status">
          <option value="unreviewed">Unreviewed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
        <select id="feedbackReasonFilter" aria-label="Translation issue reason">
          <option value="all">All reasons</option>
          <option value="wrong_meaning">Wrong meaning</option>
          <option value="unnatural">Awkward / unnatural</option>
          <option value="name_term">Name / terminology</option>
          <option value="context">Context misunderstood</option>
          <option value="grammar">Grammar</option>
          <option value="missing_words">Missing words / detail</option>
          <option value="other">Other</option>
        </select>
      </div>
      <p id="translationFeedbackSummary" class="muted"></p>
      <div id="translationFeedbackList" class="list"></div>
    `;

    const reports = $("reports");
    if (reports) reportsView.insertBefore(section, reports);
    else reportsView.append(section);
  }

  async function loadFeedback() {
    const list = $("translationFeedbackList");
    if (!list) return;
    list.innerHTML = '<p class="muted">Loading translation feedback…</p>';
    try {
      feedbackRows = await client.select(
        "translation_feedback",
        "select=report_id,customer_id,subtitle_track_id,issue_reason,current_text,suggested_text,source_surface,dataset_status,reviewed_by,reviewed_at,created_at,report:error_reports(cue_time_seconds,message,video_url,status),track:subtitle_tracks(language_code,language_name,label,video:videos(title,episode_label,provider))&order=created_at.desc&limit=200"
      );
      renderFeedback();
    } catch (error) {
      list.textContent = error.message;
    }
  }

  function renderFeedback() {
    const list = $("translationFeedbackList");
    const summary = $("translationFeedbackSummary");
    if (!list || !summary) return;

    const statusFilter = $("feedbackStatusFilter")?.value || "unreviewed";
    const reasonFilter = $("feedbackReasonFilter")?.value || "all";
    const visible = feedbackRows.filter((row) =>
      (statusFilter === "all" || row.dataset_status === statusFilter) &&
      (reasonFilter === "all" || row.issue_reason === reasonFilter)
    );

    const approvedCount = feedbackRows.filter((row) => row.dataset_status === "approved").length;
    const unreviewedCount = feedbackRows.filter((row) => row.dataset_status === "unreviewed").length;
    summary.textContent = `${unreviewedCount} unreviewed · ${approvedCount} approved · ${feedbackRows.length} total`;
    list.replaceChildren();

    for (const row of visible) list.append(buildCard(row));
    if (!visible.length) list.textContent = "No translation feedback matches these filters.";
  }

  function buildCard(row) {
    const report = one(row.report);
    const track = one(row.track);
    const video = one(track?.video);
    const item = document.createElement("article");
    item.className = "list-item translation-feedback-card";

    const title = document.createElement("strong");
    title.textContent = `${video?.title || "Unknown title"}${video?.episode_label ? ` · ${video.episode_label}` : ""} · ${track?.language_name || "Unknown language"}`;

    const meta = document.createElement("small");
    meta.className = "muted";
    meta.textContent = [
      reasonLabel(row.issue_reason),
      report?.cue_time_seconds != null ? `${report.cue_time_seconds}s` : "No time",
      row.source_surface,
      new Date(row.created_at).toLocaleString(),
    ].join(" · ");

    const pair = document.createElement("div");
    pair.className = "translation-feedback-pair";
    pair.append(
      copyBox("Current translation", row.current_text || ""),
      copyBox("Suggested correction", row.suggested_text || "No correction suggested")
    );

    if (report?.message) {
      const note = copyBox("Extra context", report.message);
      pair.after(note);
    }

    const state = document.createElement("span");
    state.className = `status-badge ${datasetStatusClass(row.dataset_status)}`;
    state.textContent = datasetStatusLabel(row.dataset_status);

    const actions = document.createElement("div");
    actions.className = "translation-feedback-actions";
    const approve = actionButton("Approve for dataset", "approve", row.dataset_status === "approved", () => review(row, "approved"));
    const reject = actionButton("Reject", "reject", row.dataset_status === "rejected", () => review(row, "rejected"));
    const reset = actionButton("Return to review", "secondary", row.dataset_status === "unreviewed", () => review(row, "unreviewed"));
    actions.append(approve, reject, reset);

    item.append(title, meta, pair);
    if (report?.message) item.append(copyBox("Extra context", report.message));
    item.append(state, actions);
    return item;
  }

  function copyBox(label, text) {
    const box = document.createElement("div");
    box.className = "translation-feedback-copy";
    const caption = document.createElement("small");
    caption.textContent = label;
    const body = document.createElement("p");
    body.textContent = text;
    box.append(caption, body);
    return box;
  }

  function actionButton(label, className, disabled, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", handler);
    return button;
  }

  async function review(row, status) {
    try {
      const session = await client.validSession();
      await client.update(
        "translation_feedback",
        {
          dataset_status: status,
          reviewed_by: status === "unreviewed" ? null : session?.user?.id || null,
          reviewed_at: status === "unreviewed" ? null : new Date().toISOString(),
        },
        `report_id=eq.${encodeURIComponent(row.report_id)}`
      );
      await loadFeedback();
      const statusNode = $("status");
      if (statusNode) statusNode.textContent = `Translation feedback marked ${status}.`;
    } catch (error) {
      const statusNode = $("status");
      if (statusNode) statusNode.textContent = error.message;
    }
  }

  function exportApprovedCsv() {
    const approved = feedbackRows.filter((row) => row.dataset_status === "approved");
    if (!approved.length) {
      const statusNode = $("status");
      if (statusNode) statusNode.textContent = "There is no approved translation feedback to export yet.";
      return;
    }

    const header = [
      "report_id",
      "title",
      "episode",
      "provider",
      "target_language",
      "language_code",
      "time_seconds",
      "issue_reason",
      "current_translation",
      "suggested_translation",
      "extra_context",
      "source_surface",
      "created_at",
    ];
    const rows = approved.map((row) => {
      const report = one(row.report);
      const track = one(row.track);
      const video = one(track?.video);
      return [
        row.report_id,
        video?.title || "",
        video?.episode_label || "",
        video?.provider || "",
        track?.language_name || "",
        track?.language_code || "",
        report?.cue_time_seconds ?? "",
        row.issue_reason,
        row.current_text || "",
        row.suggested_text || "",
        report?.message || "",
        row.source_surface || "",
        row.created_at || "",
      ];
    });

    const csv = [header, ...rows].map((columns) => columns.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `translation-feedback-approved-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    const text = String(value ?? "").replace(/"/g, '""');
    return `"${text}"`;
  }

  function reasonLabel(reason) {
    return {
      wrong_meaning: "Wrong meaning",
      unnatural: "Awkward / unnatural",
      name_term: "Name / terminology",
      context: "Context misunderstood",
      grammar: "Grammar",
      missing_words: "Missing words / detail",
      other: "Other",
    }[reason] || reason;
  }

  function datasetStatusLabel(status) {
    if (status === "approved") return "Approved for dataset";
    if (status === "rejected") return "Rejected";
    return "Needs review";
  }

  function datasetStatusClass(status) {
    if (status === "approved") return "status-complete";
    if (status === "rejected") return "status-declined";
    return "status-pending";
  }

  function one(value) {
    return Array.isArray(value) ? value[0] : value;
  }
})();
