from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass

from app.srt import SubtitleCue


class CsvSubtitleError(ValueError):
    """Raised when a CSV file cannot be interpreted as timed subtitles."""


TIME_PATTERN = re.compile(r"^\d{2,}:\d{2}:\d{2}[,.]\d{3}$")
LANGUAGE_COLUMN_CODES = {
    "arabic": "AR",
    "chinese": "ZH",
    "english": "EN",
    "farsi": "FA",
    "french": "FR",
    "german": "DE",
    "japanese": "JA",
    "korean": "KO",
    "persian": "FA",
    "spanish": "ES",
}


@dataclass(slots=True)
class CsvSubtitleDocument:
    rows: list[dict[str, str]]
    fieldnames: list[str]
    cues: list[SubtitleCue]
    source_column: str

    def add_translations(self, translated_texts: list[str], output_column: str) -> None:
        if len(translated_texts) != len(self.rows):
            raise CsvSubtitleError("The translated row count does not match the CSV input.")
        if output_column not in self.fieldnames:
            self.fieldnames.append(output_column)
        for row, translated_text in zip(self.rows, translated_texts, strict=True):
            row[output_column] = translated_text.strip()

    def render(self) -> bytes:
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=self.fieldnames, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(self.rows)
        return stream.getvalue().encode("utf-8-sig")


def parse_subtitle_csv(data: bytes, source_column: str | None = None) -> CsvSubtitleDocument:
    text = _decode_csv(data)
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""))
        fieldnames = list(reader.fieldnames or [])
        rows = [dict(row) for row in reader]
    except csv.Error as exc:
        raise CsvSubtitleError(f"Invalid CSV structure: {exc}") from exc

    if not fieldnames:
        raise CsvSubtitleError("The CSV file has no header row.")
    for required in ("St", "Et"):
        if required not in fieldnames:
            raise CsvSubtitleError(f"The CSV file is missing the '{required}' column.")
    if not rows:
        raise CsvSubtitleError("The CSV file has no subtitle rows.")

    selected_column = source_column or _select_source_column(fieldnames)
    if selected_column not in fieldnames:
        raise CsvSubtitleError(f"The CSV file has no '{selected_column}' column.")

    cues: list[SubtitleCue] = []
    for row_number, row in enumerate(rows, start=1):
        start = (row.get("St") or "").strip()
        end = (row.get("Et") or "").strip()
        subtitle_text = (row.get(selected_column) or "").strip()
        if not TIME_PATTERN.fullmatch(start) or not TIME_PATTERN.fullmatch(end):
            raise CsvSubtitleError(f"Row {row_number} has an invalid St or Et timestamp.")
        if not subtitle_text:
            raise CsvSubtitleError(f"Row {row_number} has no text in '{selected_column}'.")
        cues.append(
            SubtitleCue(
                identifier=str(row_number),
                timing=f"{start} --> {end}",
                text=subtitle_text,
            )
        )

    return CsvSubtitleDocument(
        rows=rows,
        fieldnames=fieldnames,
        cues=cues,
        source_column=selected_column,
    )


def target_column_for_language(language: str) -> str:
    normalized = language.casefold()
    for language_name, code in LANGUAGE_COLUMN_CODES.items():
        if language_name in normalized:
            return f"Subtitle_{code}"
    slug = re.sub(r"[^A-Za-z0-9]+", "_", language).strip("_").upper()
    return f"Subtitle_{slug or 'TRANSLATED'}"


def _select_source_column(fieldnames: list[str]) -> str:
    for preferred in ("Subtitle_KO", "Subtitle", "Text", "text"):
        if preferred in fieldnames:
            return preferred
    subtitle_columns = [name for name in fieldnames if name.startswith("Subtitle_")]
    if subtitle_columns:
        return subtitle_columns[0]
    raise CsvSubtitleError(
        "The CSV needs a Subtitle, Subtitle_KO, or another Subtitle_* text column."
    )


def _decode_csv(data: bytes) -> str:
    if not data:
        raise CsvSubtitleError("The file is empty.")
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise CsvSubtitleError("The CSV encoding is not supported. Save it as UTF-8.")
