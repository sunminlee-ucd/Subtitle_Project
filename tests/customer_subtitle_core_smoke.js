"use strict";

const core = require("../customer_extension/subtitle-core.js");
const cues = core.parseSrt(
  "1\r\n00:00:01,000 --> 00:00:02,500\r\nسلام\r\n\r\n" +
  "2\r\n00:00:03.000 --> 00:00:04.000\r\nخوبی؟\r\n"
);

if (cues.length !== 2) process.exit(1);
if (cues[0].start !== 1 || cues[0].end !== 2.5) process.exit(2);
if (cues[1].text !== "خوبی؟") process.exit(3);

console.log("customer subtitle core smoke checks passed");
