(() => {
  "use strict";

  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const MIB = 1024 * 1024;
  const GIB = 1024 * MIB;
  const LIMITS = {
    supabaseDatabase: 500_000_000,
    supabaseStorage: 1_000_000_000,
    supabaseMau: 50_000,
    cloudBuildMinutes: 2_500,
    artifactRegistry: 0.5 * GIB,
  };
  const loadedViews = new Set();
  let currentUsageView = "supabase";

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("refreshUsage")?.addEventListener("click", () => loadCurrentUsage(true));
    document.querySelectorAll("[data-usage-view]").forEach((button) => {
      button.addEventListener("click", () => showUsageView(button.dataset.usageView));
    });
    document.querySelector('[data-admin-view="usage"]')?.addEventListener("click", () => {
      showUsageView(currentUsageView);
    });
    showUsageView("supabase", false);
  });

  function showUsageView(name, shouldLoad = true) {
    const selected = name === "cloud-run" ? "cloud-run" : "supabase";
    currentUsageView = selected;

    document.querySelectorAll("[data-usage-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.usagePanel !== selected;
    });
    document.querySelectorAll("[data-usage-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.usageView === selected);
    });

    if (shouldLoad && !loadedViews.has(selected)) {
      loadCurrentUsage(false);
    }
  }

  async function loadCurrentUsage(forceRefresh = false) {
    const status = document.getElementById("usageStatus");
    if (!forceRefresh && loadedViews.has(currentUsageView)) return;
    if (status) status.textContent = "Refreshing usage…";

    if (currentUsageView === "cloud-run") {
      await loadCloudRun();
      renderReferenceServices();
    } else {
      await loadSupabase();
    }

    loadedViews.add(currentUsageView);
    if (status) status.textContent = `Updated ${new Date().toLocaleString()}`;
  }

  async function loadSupabase() {
    const root = document.getElementById("supabaseUsage");
    if (!root) return;
    root.innerHTML = '<p class="muted">Loading Supabase usage…</p>';
    try {
      const data = await client.rpc("admin_usage_snapshot");
      root.replaceChildren(
        usageCard("Database", data.database_bytes, LIMITS.supabaseDatabase, formatBytes),
        usageCard("Storage", data.storage_bytes, LIMITS.supabaseStorage, formatBytes),
        usageCard("Registered users", data.registered_users, LIMITS.supabaseMau, formatNumber),
        infoCard("Subtitle tracks", `${formatNumber(data.subtitle_tracks)} total · ${formatNumber(data.tracks_with_storage)} in Storage`),
        warningCard(
          "Legacy / duplicated subtitle data",
          `${formatNumber(data.legacy_tracks)} legacy track · ${formatBytes(data.cues_json_bytes)} cues JSON still stored in PostgreSQL`,
          Number(data.legacy_tracks) > 0 || Number(data.cues_json_bytes) > 0
        ),
        infoCard("Egress", "Not measured by this app. Free plan includes separate uncached and cached egress allowances; verify monthly egress in the Supabase Usage dashboard.")
      );
    } catch (error) {
      root.innerHTML = `<p class="usage-error">${escapeHtml(error.message)}</p>`;
    }
  }

  async function loadCloudRun() {
    const root = document.getElementById("cloudRunUsage");
    if (!root) return;
    root.innerHTML = '<p class="muted">Loading Cloud Run usage…</p>';
    try {
      const response = await fetch("/api/usage/cloud-run", { cache: "no-store" });
      const data = await response.json();
      if (!data.available) {
        root.replaceChildren(
          warningCard("Automatic monitoring unavailable", data.message || "Cloud Monitoring could not be read.", true),
          infoCard("Free-tier reference", "2,000,000 requests · 180,000 vCPU-s · 360,000 GiB-s per month for request-based services."),
          infoCard("Scope", data.scope_note || "Free tier is shared across projects on the billing account.")
        );
        return;
      }
      root.replaceChildren(
        usageCard("Requests", data.requests, data.limits.requests, formatNumber),
        usageCard("CPU", data.estimated_vcpu_seconds, data.limits.vcpu_seconds, formatSeconds),
        usageCard("Memory", data.estimated_gib_seconds, data.limits.gib_seconds, formatGibSeconds),
        infoCard("Service allocation", `${data.cpu} vCPU · ${data.memory_gib} GiB memory`),
        infoCard("Scope", data.scope_note)
      );
    } catch (error) {
      root.innerHTML = `<p class="usage-error">${escapeHtml(error.message)}</p>`;
    }
  }

  function renderReferenceServices() {
    const root = document.getElementById("otherUsage");
    if (!root) return;
    root.replaceChildren(
      infoCard("Cloud Build", `${formatNumber(LIMITS.cloudBuildMinutes)} free e2-standard-2 build-minutes/month per billing account. Live build-minute aggregation is not connected here yet.`),
      infoCard("Artifact Registry", `${formatBytes(LIMITS.artifactRegistry)}-month free storage per billing account. Keep old container images cleaned up.`),
      infoCard("Important", "Free-tier quotas and prices can change. Treat this page as an early-warning dashboard, not a billing guarantee.")
    );
  }

  function usageCard(label, rawValue, rawLimit, formatter) {
    const value = Number(rawValue || 0);
    const limit = Number(rawLimit || 0);
    const percent = limit > 0 ? (value / limit) * 100 : 0;
    const level = percent >= 95 ? "danger" : percent >= 85 ? "warning" : percent >= 70 ? "watch" : "ok";
    const card = document.createElement("article");
    card.className = `usage-card usage-${level}`;
    card.innerHTML = `
      <div class="usage-card-top"><strong>${escapeHtml(label)}</strong><span>${percent.toFixed(percent < 1 ? 2 : 1)}%</span></div>
      <div class="usage-value">${escapeHtml(formatter(value))} <small>/ ${escapeHtml(formatter(limit))}</small></div>
      <div class="usage-meter"><span style="width:${Math.min(percent, 100)}%"></span></div>
    `;
    return card;
  }

  function infoCard(label, text) {
    const card = document.createElement("article");
    card.className = "usage-card usage-info";
    card.innerHTML = `<strong>${escapeHtml(label)}</strong><p>${escapeHtml(String(text || ""))}</p>`;
    return card;
  }

  function warningCard(label, text, active) {
    const card = infoCard(label, text);
    if (active) card.className = "usage-card usage-warning";
    return card;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GiB`;
    if (bytes >= MIB) return `${(bytes / MIB).toFixed(2)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${Math.round(bytes)} B`;
  }

  function formatNumber(value) {
    return Math.round(Number(value || 0)).toLocaleString();
  }

  function formatSeconds(value) {
    return `${Math.round(Number(value || 0)).toLocaleString()} vCPU-s`;
  }

  function formatGibSeconds(value) {
    return `${Math.round(Number(value || 0)).toLocaleString()} GiB-s`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
