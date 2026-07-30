from __future__ import annotations

import re
from dataclasses import dataclass


class SrtParseError(ValueError):
    """Raised when an uploaded file is not valid enough to process safely."""


TIMESTAMP_PATTERN = re.compile(
    r"^(?P<start>\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{2,}:\d{2}:\d{2}[,.]\d{3})(?P<settings>.*)$"
)


@dataclass(slots=True)
class SubtitleCue:
    identifier: str
    timing: str
    text: str


@dataclass(slots=True)
class SrtDocument:
    cues: list[SubtitleCue]
    newline: str = "\n"

    def render(self) -> str:
        blocks = [self.newline.join((cue.identifier, cue.timing, cue.text)) for cue in self.cues]
        return (self.newline * 2).join(blocks) + self.newline


def decode_srt(data: bytes) -> str:
    if not data:
        raise SrtParseError("The file is empty.")

    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise SrtParseError("The file encoding is not supported. Save it as UTF-8.")


def parse_srt(data: bytes) -> SrtDocument:
    text = decode_srt(data)
    newline = "\r\n" if "\r\n" in text else "\n"
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise SrtParseError("The file does not contain subtitle cues.")

    raw_blocks = re.split(r"\n[ \t]*\n+", normalized)
    cues: list[SubtitleCue] = []

    for block_number, block in enumerate(raw_blocks, start=1):
        lines = block.split("\n")
        if len(lines) < 3:
            raise SrtParseError(f"Cue {block_number} is incomplete.")

        identifier = lines[0].strip()
        timing = lines[1].strip()
        if not identifier:
            raise SrtParseError(f"Cue {block_number} has no identifier.")
        if not TIMESTAMP_PATTERN.match(timing):
            raise SrtParseError(f"Cue {identifier} has an invalid timestamp line.")

        cue_text = "\n".join(lines[2:]).strip()
        if not cue_text:
            raise SrtParseError(f"Cue {identifier} has no subtitle text.")
        cues.append(SubtitleCue(identifier=identifier, timing=timing, text=cue_text))

    if not cues:
        raise SrtParseError("The file does not contain subtitle cues.")
    return SrtDocument(cues=cues, newline=newline)
