from __future__ import annotations

import csv
import io
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from app.srt import SubtitleCue


class TtmlSubtitleError(ValueError):
    """Raised when a Netflix TTML document cannot be converted safely."""


TTML_PARAMETER_NS = "http://www.w3.org/ns/ttml#parameter"
XML_NS = "http://www.w3.org/XML/1998/namespace"
LANGUAGE_CODES = {
    "ar": "AR",
    "de": "DE",
    "en": "EN",
    "es": "ES",
    "fa": "FA",
    "fr": "FR",
    "ja": "JA",
    "ko": "KO",
    "zh": "ZH",
}
OFFSET_TIME = re.compile(r"^(?P<value>\d+(?:\.\d+)?)(?P<unit>h|m|s|ms|f|t)$")
CLOCK_TIME = re.compile(
    r"^(?P<hours>\d{2,}):(?P<minutes>\d{2}):(?P<seconds>\d{2})(?:[.,](?P<fraction>\d+))?$"
)


@dataclass(frozen=True, slots=True)
class TtmlDocument:
    cues: tuple[SubtitleCue, ...]
    language: str
    tick_rate: float

    @property
    def source_column(self) -> str:
        primary = self.language.casefold().split("-", maxsplit=1)[0]
        return f"Subtitle_{LANGUAGE_CODES.get(primary, primary.upper() or 'SOURCE')}"

    def render_csv(self) -> bytes:
        stream = io.StringIO(newline="")
        fieldnames = ["Cue_ID", "St", "Et", self.source_column]
        writer = csv.DictWriter(stream, fieldnames=fieldnames, lineterminator="\r\n")
        writer.writeheader()
        for cue in self.cues:
            start, end = (part.strip() for part in cue.timing.split("-->", maxsplit=1))
            writer.writerow(
                {
                    "Cue_ID": cue.identifier,
                    "St": start,
                    "Et": end,
                    self.source_column: cue.text,
                }
            )
        return stream.getvalue().encode("utf-8-sig")


def parse_ttml(data: bytes) -> TtmlDocument:
    if not data:
        raise TtmlSubtitleError("The TTML/XML file is empty.")
    try:
        root = ET.fromstring(data)
    except (ET.ParseError, UnicodeError) as exc:
        raise TtmlSubtitleError(f"Invalid TTML/XML structure: {exc}") from exc

    if _local_name(root.tag) != "tt":
        raise TtmlSubtitleError("The XML root is not a TTML <tt> element.")

    tick_rate = _positive_float(root.attrib.get(f"{{{TTML_PARAMETER_NS}}}tickRate"), 1.0)
    frame_rate = _positive_float(root.attrib.get(f"{{{TTML_PARAMETER_NS}}}frameRate"), 30.0)
    language = root.attrib.get(f"{{{XML_NS}}}lang", "und").strip() or "und"
    cues: list[SubtitleCue] = []
    for element in root.iter():
        if _local_name(element.tag) != "p":
            continue
        begin_raw = element.attrib.get("begin")
        end_raw = element.attrib.get("end")
        duration_raw = element.attrib.get("dur")
        if not begin_raw or (not end_raw and not duration_raw):
            continue
        begin = _parse_time(begin_raw, tick_rate=tick_rate, frame_rate=frame_rate)
        end = (
            _parse_time(end_raw, tick_rate=tick_rate, frame_rate=frame_rate)
            if end_raw
            else begin + _parse_time(duration_raw or "", tick_rate=tick_rate, frame_rate=frame_rate)
        )
        text = _cue_text(element)
        if not text:
            continue
        if end <= begin:
            raise TtmlSubtitleError(f"Cue {len(cues) + 1} ends before it starts.")
        cues.append(
            SubtitleCue(
                identifier=str(len(cues) + 1),
                timing=f"{_srt_timestamp(begin)} --> {_srt_timestamp(end)}",
                text=text,
            )
        )

    if not cues:
        raise TtmlSubtitleError("No timed subtitle cues were found in the TTML/XML file.")
    return TtmlDocument(cues=tuple(cues), language=language, tick_rate=tick_rate)


def _parse_time(value: str, *, tick_rate: float, frame_rate: float) -> float:
    raw = value.strip()
    clock = CLOCK_TIME.fullmatch(raw)
    if clock:
        fraction = float(f"0.{clock.group('fraction')}") if clock.group("fraction") else 0.0
        return (
            int(clock.group("hours")) * 3600
            + int(clock.group("minutes")) * 60
            + int(clock.group("seconds"))
            + fraction
        )
    offset = OFFSET_TIME.fullmatch(raw)
    if not offset:
        raise TtmlSubtitleError(f"Unsupported TTML timestamp: {value}")
    amount = float(offset.group("value"))
    unit = offset.group("unit")
    if unit == "h":
        return amount * 3600
    if unit == "m":
        return amount * 60
    if unit == "ms":
        return amount / 1000
    if unit == "f":
        return amount / frame_rate
    if unit == "t":
        return amount / tick_rate
    return amount


def _cue_text(element: ET.Element) -> str:
    parts: list[str] = []

    def visit(node: ET.Element) -> None:
        if node.text:
            parts.append(node.text)
        for child in node:
            if _local_name(child.tag) == "br":
                parts.append("\n")
            else:
                visit(child)
            if child.tail:
                parts.append(child.tail)

    visit(element)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in "".join(parts).splitlines()]
    return "\n".join(line for line in lines if line)


def _srt_timestamp(seconds: float) -> str:
    total_milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(total_milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds:03d}"


def _local_name(tag: str) -> str:
    return tag.rsplit("}", maxsplit=1)[-1]


def _positive_float(value: str | None, default: float) -> float:
    try:
        parsed = float(value) if value is not None else default
    except ValueError as exc:
        raise TtmlSubtitleError(f"Invalid TTML timing rate: {value}") from exc
    if parsed <= 0:
        raise TtmlSubtitleError(f"TTML timing rate must be positive: {value}")
    return parsed
