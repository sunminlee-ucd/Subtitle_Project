((root, factory) => {
  const api = factory();
  root.SubtitleSyncCore = api;
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "object" ? globalThis : this, () => {
  "use strict";

  function clamp(value, minimum, maximum) {
    const finiteValue = Number.isFinite(value) ? value : minimum;
    return Math.min(maximum, Math.max(minimum, finiteValue));
  }

  function timestampToSeconds(rawTimestamp) {
    const match = String(rawTimestamp)
      .trim()
      .match(/^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/);
    if (!match) {
      throw new Error(`Invalid SRT timestamp: ${rawTimestamp}`);
    }
    const [, hours, minutes, seconds, milliseconds] = match;
    const normalizedMilliseconds = Number(milliseconds.padEnd(3, "0").slice(0, 3));
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + normalizedMilliseconds / 1000;
  }

  function parseSrt(rawContent) {
    const normalized = String(rawContent || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n")
      .trim();
    if (!normalized) {
      throw new Error("The selected SRT file is empty.");
    }

    const cues = [];
    for (const block of normalized.split(/\n{2,}/)) {
      const lines = block.split("\n");
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) {
        continue;
      }
      const timingMatch = lines[timingIndex].match(
        /^\s*(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})\s*-->\s*(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})(?:\s+.*)?$/
      );
      if (!timingMatch) {
        throw new Error(`Invalid SRT timing line: ${lines[timingIndex]}`);
      }
      const start = timestampToSeconds(timingMatch[1]);
      const end = timestampToSeconds(timingMatch[2]);
      const text = lines.slice(timingIndex + 1).join("\n").trim();
      if (!text || end <= start) {
        continue;
      }
      cues.push({ start, end, text });
    }
    if (!cues.length) {
      throw new Error("No valid subtitle cues were found in the SRT file.");
    }
    cues.sort((left, right) => left.start - right.start || left.end - right.end);
    return cues;
  }

  function activeSubtitleText(cues, videoTime, offsetSeconds = 0) {
    const subtitleTime = Number(videoTime) - Number(offsetSeconds || 0);
    return cues
      .filter((cue) => cue.start <= subtitleTime && subtitleTime < cue.end)
      .map((cue) => cue.text)
      .join("\n");
  }

  function activeSubtitleCueIndices(cues, videoTime, offsetSeconds = 0) {
    const subtitleTime = Number(videoTime) - Number(offsetSeconds || 0);
    return cues
      .map((cue, index) => ({ cue, index }))
      .filter(({ cue }) => cue.start <= subtitleTime && subtitleTime < cue.end)
      .map(({ index }) => index);
  }

  function cuePlaybackBounds(cue, offsetSeconds = 0) {
    const offset = Number.isFinite(Number(offsetSeconds)) ? Number(offsetSeconds) : 0;
    const start = Math.max(0, Number(cue?.start || 0) + offset);
    const end = Math.max(start + 0.05, Number(cue?.end || 0) + offset);
    return { start, end };
  }

  function cleanCapturedSubtitle(rawText) {
    let text = String(rawText || "").replace(/\u2026/g, "...");
    text = text.replace(/\[(.*?)\]/g, (_match, inner) => {
      const cleaned = inner.replace(/\s*\.\.\.\s*/g, " ").replace(/\s+/g, " ").trim();
      return `[${cleaned}]`;
    });
    text = text.replace(/\s+\.\.\.\s+/g, " ");
    text = text.replace(/^\s*\.\.\.\s+/g, "");
    text = text.replace(/(\.\.\.){2,}/g, "...");
    text = text.replace(/\s+([,!.?])/g, "$1");
    text = text.replace(/([,!.?])(\S)/g, "$1 $2");
    text = text.replace(/\s*-\s*/g, " - ");
    text = text.replace(/\[\s+/g, "[").replace(/\s+\]/g, "]");
    return text.replace(/\s+/g, " ").trim();
  }

  function parseNetflixVideoLabel(rawText) {
    const lines = [
      ...new Set(
        String(rawText || "")
          .split(/\r?\n/)
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean)
      )
    ];
    if (!lines.length) {
      return { title: "", episode: "" };
    }
    const inlineEpisode = lines
      .map((line) => ({
        line,
        match: line.match(/\b((?:S(?:eason)?\s*\d+\s*[:.-]\s*)?E\s*\d+\b.*)$/i)
      }))
      .find((item) => item.match);
    if (inlineEpisode?.match) {
      return {
        title: inlineEpisode.line.slice(0, inlineEpisode.match.index).trim(),
        episode: inlineEpisode.match[1].trim()
      };
    }
    const episodePattern = /^(?:S(?:eason)?\s*\d+\s*[:.-]?\s*)?E(?:pisode)?\s*\d+|^Episode\s*\d+|^시즌\s*\d+|^\d+화\b/i;
    const episodeIndex = lines.findIndex((line) => episodePattern.test(line));
    if (episodeIndex >= 0) {
      return {
        title: lines.slice(0, episodeIndex).join(" - "),
        episode: lines.slice(episodeIndex).join(" ")
      };
    }
    return { title: lines[0], episode: lines.slice(1).join(" - ") };
  }

  function secondsToSrtTimestamp(totalSeconds) {
    const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
    const totalMilliseconds = Math.round(safeSeconds * 1000);
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function capturedRowsToCsv(rows) {
    const body = rows.map((row) =>
      [
        csvEscape(secondsToSrtTimestamp(row.start)),
        csvEscape(secondsToSrtTimestamp(row.end)),
        csvEscape(row.text)
      ].join(",")
    );
    return ["St,Et,Subtitle", ...body, ""].join("\n");
  }

  function capturedRowsToSrt(rows) {
    return rows.map((row, index) =>
      `${index + 1}\n${secondsToSrtTimestamp(row.start)} --> ${secondsToSrtTimestamp(row.end)}\n${row.text}`
    ).join("\n\n") + (rows.length ? "\n" : "");
  }

  return {
    activeSubtitleText,
    activeSubtitleCueIndices,
    cuePlaybackBounds,
    capturedRowsToCsv,
    capturedRowsToSrt,
    clamp,
    cleanCapturedSubtitle,
    parseNetflixVideoLabel,
    parseSrt,
    secondsToSrtTimestamp,
    timestampToSeconds
  };
});
