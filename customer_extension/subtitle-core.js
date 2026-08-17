((root, factory) => {
  const api = factory();
  root.CustomerSubtitleCore = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  function normalizeCues(rawCues) {
    if (!Array.isArray(rawCues)) {
      throw new Error("Subtitle cue data is invalid.");
    }
    return rawCues
      .map((cue) => ({
        start: Number(cue?.start),
        end: Number(cue?.end),
        text: String(cue?.text || "").trim()
      }))
      .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start && cue.text)
      .sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function parseSrt(raw) {
    const normalized = String(raw || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .trim();
    const cues = [];
    for (const block of normalized.split(/\n{2,}/)) {
      const lines = block.split("\n");
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const match = lines[timingIndex].match(
        /^(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})\s*-->\s*(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})/
      );
      const text = lines.slice(timingIndex + 1).join("\n").trim();
      if (!match || !text) continue;
      const start = timestampSeconds(match[1]);
      const end = timestampSeconds(match[2]);
      if (end > start) cues.push({ start, end, text });
    }
    if (!cues.length) {
      throw new Error("No valid subtitle lines were found in the SRT file.");
    }
    return normalizeCues(cues);
  }

  function timestampSeconds(value) {
    const [hours, minutes, tail] = value.replace(",", ".").split(":");
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(tail);
  }

  function activeCueIndices(cues, videoTime, offsetSeconds = 0) {
    const subtitleTime = Number(videoTime) - Number(offsetSeconds || 0);
    return cues
      .map((cue, index) => ({ cue, index }))
      .filter(({ cue }) => cue.start <= subtitleTime && subtitleTime < cue.end)
      .map(({ index }) => index);
  }

  function playbackBounds(cue, offsetSeconds = 0) {
    const offset = Number(offsetSeconds || 0);
    const start = Math.max(0, cue.start + offset);
    return { start, end: Math.max(start + 0.05, cue.end + offset) };
  }

  function pageVideoIdentity(url = globalThis.location?.href || "") {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (host.endsWith("netflix.com")) {
      return { provider: "netflix", key: parsed.pathname.match(/\/watch\/(\d+)/)?.[1] || "" };
    }
    if (host.endsWith("disneyplus.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      return { provider: "disney", key: parts.at(-1) || "" };
    }
    if (host.endsWith("youtube.com")) {
      return { provider: "youtube", key: parsed.searchParams.get("v") || "" };
    }
    return { provider: "other", key: parsed.pathname };
  }

  return { activeCueIndices, normalizeCues, pageVideoIdentity, parseSrt, playbackBounds };
});
