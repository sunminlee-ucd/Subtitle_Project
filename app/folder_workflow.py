from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.csv_subtitles import parse_subtitle_csv, target_column_for_language
from app.srt import parse_srt
from app.translator import SubtitleTranslator

SUPPORTED_SUFFIXES = {".csv", ".srt"}


@dataclass(frozen=True, slots=True)
class FolderTranslationResult:
    source_file: str
    output_file: str
    cue_count: int
    source_column: str | None
    output_column: str | None


def subtitle_files(input_directory: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in input_directory.iterdir()
            if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES
        ),
        key=lambda path: path.name.casefold(),
    )


def prepare_directories(input_directory: Path, output_directory: Path) -> list[Path]:
    input_directory.mkdir(parents=True, exist_ok=True)
    output_directory.mkdir(parents=True, exist_ok=True)
    return subtitle_files(input_directory)


async def translate_input_folder(
    *,
    input_directory: Path,
    output_directory: Path,
    translator: SubtitleTranslator,
    target_language: str,
    source_language: str | None = None,
    source_column: str | None = None,
    max_files: int = 20,
    max_file_size_bytes: int = 5 * 1024 * 1024,
) -> list[FolderTranslationResult]:
    files = prepare_directories(input_directory, output_directory)
    if not files:
        raise ValueError(f"No .srt or .csv files were found in {input_directory}.")
    if len(files) > max_files:
        raise ValueError(f"A maximum of {max_files} files can be translated at once.")

    results: list[FolderTranslationResult] = []
    for source_path in files:
        if source_path.stat().st_size > max_file_size_bytes:
            raise ValueError(f"{source_path.name} is larger than the configured file limit.")

        content = source_path.read_bytes()
        suffix = source_path.suffix.lower()
        document = (
            parse_srt(content)
            if suffix == ".srt"
            else parse_subtitle_csv(content, source_column=source_column)
        )
        translated_texts = await translator.translate(
            document.cues,
            target_language=target_language,
            source_language=source_language,
        )
        if len(translated_texts) != len(document.cues):
            raise RuntimeError(f"{source_path.name}: translator returned an incomplete result.")

        output_column = None
        if suffix == ".srt":
            for cue, translated_text in zip(document.cues, translated_texts, strict=True):
                cue.text = translated_text.strip()
            rendered = document.render().encode("utf-8-sig")
        else:
            output_column = target_column_for_language(target_language)
            document.add_translations(translated_texts, output_column)
            rendered = document.render()

        output_name = _output_name(source_path, target_language)
        (output_directory / output_name).write_bytes(rendered)
        results.append(
            FolderTranslationResult(
                source_file=source_path.name,
                output_file=output_name,
                cue_count=len(document.cues),
                source_column=getattr(document, "source_column", None),
                output_column=output_column,
            )
        )

    summary = {
        "target_language": target_language,
        "source_language": source_language or "auto-detect",
        "translated_at": datetime.now(UTC).isoformat(),
        "files": [asdict(result) for result in results],
    }
    (output_directory / "translation_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return results


def _output_name(source_path: Path, target_language: str) -> str:
    language_slug = re.sub(r"[^\w-]+", "-", target_language.casefold(), flags=re.UNICODE).strip("-")
    return f"{source_path.stem}.{language_slug}{source_path.suffix.lower()}"
