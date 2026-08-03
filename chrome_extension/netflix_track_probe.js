(() => {
  "use strict";

  if (window.__subtitleTrackNetworkProbeInstalled) {
    return;
  }
  window.__subtitleTrackNetworkProbeInstalled = true;

  const CONTROL_SOURCE = "subtitle-sync-extension-control";
  const EVENT_SOURCE = "subtitle-sync-page-probe";
  const MAX_CAPTURE_CHARACTERS = 12_000_000;
  const MAX_CANDIDATES = 12;
  const MAX_TOTAL_CHARACTERS = 24_000_000;
  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  let active = true;
  let queuedCharacters = 0;
  let queuedCandidates = [];
  const queuedFingerprints = new Set();

  function sanitizedPath(rawUrl) {
    try {
      const url = new URL(String(rawUrl || ""), location.href);
      return `${url.hostname}${url.pathname}`;
    } catch (_error) {
      return "unknown";
    }
  }

  function detectedFormat(text, contentType, rawUrl) {
    const sample = String(text || "").slice(0, 8000).trim().toLowerCase();
    const type = String(contentType || "").toLowerCase();
    const url = String(rawUrl || "").toLowerCase();
    if (sample.startsWith("webvtt") || type.includes("text/vtt")) {
      return "webvtt";
    }
    if (
      sample.includes("<tt") &&
      (sample.includes("ttml") || sample.includes("timedtext") || sample.includes("<p"))
    ) {
      return "ttml";
    }
    if (sample.includes("<transcript") || sample.includes("<text start=")) {
      return "xml_timed_text";
    }
    if (
      (url.includes("timedtext") || url.includes("subtitle") || url.includes("caption")) &&
      (sample.startsWith("{") || sample.startsWith("["))
    ) {
      return "json_candidate";
    }
    return "unknown";
  }

  function fingerprint(path, format, text) {
    const sample = `${path}|${format}|${text.length}|${text.slice(0, 256)}`;
    let hash = 2166136261;
    for (let index = 0; index < sample.length; index += 1) {
      hash ^= sample.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${format}-${(hash >>> 0).toString(16)}`;
  }

  function emitCandidate(payload) {
    window.postMessage(
      {
        source: EVENT_SOURCE,
        type: "TRACK_CANDIDATE",
        payload
      },
      "*"
    );
  }

  function publishCandidate(rawUrl, contentType, text, transport) {
    if (!active || !text || text.length > MAX_CAPTURE_CHARACTERS) {
      return;
    }
    const format = detectedFormat(text, contentType, rawUrl);
    const urlLooksRelevant = /timedtext|subtitle|caption|ttml|webvtt/i.test(String(rawUrl));
    if (format === "unknown" && !urlLooksRelevant) {
      return;
    }
    const path = sanitizedPath(rawUrl);
    const candidateFingerprint = fingerprint(path, format, text);
    if (queuedFingerprints.has(candidateFingerprint)) {
      return;
    }
    if (
      queuedCandidates.length >= MAX_CANDIDATES ||
      queuedCharacters + text.length > MAX_TOTAL_CHARACTERS
    ) {
      return;
    }
    const payload = {
      content: text,
      contentType: String(contentType || ""),
      fingerprint: candidateFingerprint,
      format,
      path,
      size: text.length,
      transport,
      videoKey: location.pathname.match(/\/watch\/(\d+)/)?.[1] || location.pathname
    };
    queuedFingerprints.add(candidateFingerprint);
    queuedCandidates.push(payload);
    queuedCharacters += text.length;
    emitCandidate(payload);
  }

  function replayQueuedCandidates() {
    for (const candidate of queuedCandidates) {
      emitCandidate(candidate);
    }
  }

  function clearQueuedCandidates() {
    queuedCandidates = [];
    queuedCharacters = 0;
    queuedFingerprints.clear();
  }

  async function inspectFetchResponse(response, rawUrl) {
    try {
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      publishCandidate(rawUrl, contentType, text, "fetch");
    } catch (_error) {
      // A locked, opaque, or binary response is not a readable subtitle candidate.
    }
  }

  window.fetch = async function subtitleProbeFetch(...args) {
    const response = await originalFetch.apply(this, args);
    if (active) {
      const rawUrl = response.url || args[0]?.url || args[0] || "";
      inspectFetchResponse(response.clone(), rawUrl);
    }
    return response;
  };

  XMLHttpRequest.prototype.open = function subtitleProbeOpen(method, url, ...rest) {
    const rawUrl = url;
    this.addEventListener(
      "load",
      () => {
        if (!active) {
          return;
        }
        try {
          const contentType = this.getResponseHeader("content-type") || "";
          let text = "";
          if (!this.responseType || this.responseType === "text") {
            text = this.responseText || "";
          } else if (this.responseType === "arraybuffer" && this.response) {
            text = new TextDecoder("utf-8").decode(this.response);
          }
          publishCandidate(this.responseURL || rawUrl, contentType, text, "xhr");
        } catch (_error) {
          // Ignore unreadable response bodies without affecting Netflix playback.
        }
      },
      { once: true }
    );
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.data?.source !== CONTROL_SOURCE ||
      event.data?.type !== "SET_TRACK_PROBE_ACTIVE"
    ) {
      return;
    }
    if (event.data.clearCandidates) {
      clearQueuedCandidates();
    }
    active = Boolean(event.data.active);
    if (active && event.data.replayCandidates) {
      replayQueuedCandidates();
    }
  });
})();
