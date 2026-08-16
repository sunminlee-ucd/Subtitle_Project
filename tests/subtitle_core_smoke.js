"use strict";

const core = require("../chrome_extension/subtitle_core.js");

const cues = core.parseSrt(
  "1\r\n00:00:01,000 --> 00:00:02,500\r\nسلام\r\n\r\n" +
  "2\r\n00:00:03.000 --> 00:00:04.000\r\nخوبی؟\r\n"
);
if (cues.length !== 2) process.exit(1);
if (core.activeSubtitleText(cues, 1.5, 0) !== "سلام") process.exit(2);
if (core.activeSubtitleText(cues, 2.0, 1) !== "سلام") process.exit(3);
if (core.activeSubtitleText(cues, 3.2, 0) !== "خوبی؟") process.exit(4);

const rows = [{ start: 1, end: 2.5, text: "سلام" }];
const csv = core.capturedRowsToCsv(rows);
const srt = core.capturedRowsToSrt(rows);
if (!csv.includes('"00:00:01,000","00:00:02,500",سلام')) process.exit(5);
if (!srt.includes("00:00:01,000 --> 00:00:02,500")) process.exit(6);
if (core.cleanCapturedSubtitle("...  Hello  ... world") !== "Hello world") process.exit(7);
const metadata = core.parseNetflixVideoLabel("Teach You a Lesson E4 Episode 4");
if (metadata.title !== "Teach You a Lesson") process.exit(8);
if (metadata.episode !== "E4 Episode 4") process.exit(9);
const bounds = core.cuePlaybackBounds(cues[0], 1.25);
if (bounds.start !== 2.25 || bounds.end !== 3.75) process.exit(10);
if (core.activeSubtitleCueIndices(cues, 3.2, 0)[0] !== 1) process.exit(11);

console.log("subtitle core smoke checks passed");
