from __future__ import annotations

import csv
import io
import json
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

from app.csv_subtitles import parse_subtitle_csv, target_column_for_language
from app.srt import TIMESTAMP_PATTERN, SrtDocument, SubtitleCue
from app.translator import SubtitleTranslator, TranslationIssue, TranslationProgress

SAVE_PHRASE_PATTERN = re.compile(r"(?:\s*Save Phrase\s*)+$", re.IGNORECASE)
PLACEHOLDER_TEXTS = {
    "- the first subtitle has not started yet. -",
    "the first subtitle has not started yet.",
}


@dataclass(frozen=True, slots=True)
class EpisodeAnalysis:
    episode_number: int
    source_row_start: int
    source_row_end: int
    cue_count: int
    first_start: str
    last_end: str
    boundary_before: str
    boundary_after: str
    partial_start: bool
    completion_status: str


@dataclass(frozen=True, slots=True)
class EpisodeSegment:
    analysis: EpisodeAnalysis
    cues: tuple[SubtitleCue, ...]


@dataclass(frozen=True, slots=True)
class TranslatedEpisode:
    analysis: EpisodeAnalysis
    output_file: str
    cue_count: int
    content: bytes
    quality_report_file: str
    quality_report_content: bytes
    issue_count: int
    warnings: tuple[str, ...]
    translated_csv_file: str
    translated_csv_content: bytes


@dataclass(frozen=True, slots=True)
class SkippedEpisode:
    analysis: EpisodeAnalysis
    reason: str


@dataclass(frozen=True, slots=True)
class TranslationPackage:
    source_file: str
    source_language: str
    target_language: str
    episodes: tuple[TranslatedEpisode, ...]
    skipped_episodes: tuple[SkippedEpisode, ...]


@dataclass(frozen=True, slots=True)
class PipelineProgress:
    episode_number: int
    stage: str
    message: str
    overall_percent: float
    completed: int
    total: int


PipelineProgressCallback = Callable[[PipelineProgress], None]


def timestamp_to_seconds(value: str) -> float:
    normalized = value.strip().replace(",", ".")
    hours, minutes, seconds = normalized.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def cue_times(cue: SubtitleCue) -> tuple[str, str]:
    match = TIMESTAMP_PATTERN.fullmatch(cue.timing)
    if not match:
        raise ValueError(f"Cue {cue.identifier} has an invalid timestamp line.")
    return match.group("start"), match.group("end")


def analyze_combined_csv(
    data: bytes,
    *,
    source_column: str | None = None,
    starting_episode: int = 1,
    reset_threshold_seconds: float = 10 * 60,
    confirmation_cues: int = 3,
    partial_start_after_seconds: float = 5 * 60,
    final_segment_complete: bool = False,
) -> list[EpisodeSegment]:
    if starting_episode <= 0:
        raise ValueError("The starting episode number must be greater than zero.")
    if reset_threshold_seconds <= 0:
        raise ValueError("The reset threshold must be greater than zero.")

    document = parse_subtitle_csv(data, source_column=source_column)
    starts = [timestamp_to_seconds(cue_times(cue)[0]) for cue in document.cues]
    boundary_indexes: list[int] = []
    for index in range(1, len(starts)):
        drop = starts[index - 1] - starts[index]
        if drop < reset_threshold_seconds:
            continue
        if _is_confirmed_progression(starts, index, confirmation_cues):
            boundary_indexes.append(index)

    segment_starts = [0, *boundary_indexes]
    segments: list[EpisodeSegment] = []
    for segment_index, start_index in enumerate(segment_starts):
        if segment_index + 1 < len(segment_starts):
            end_index = segment_starts[segment_index + 1]
        else:
            end_index = len(starts)
        cues = tuple(document.cues[start_index:end_index])
        first_start, _ = cue_times(cues[0])
        _, last_end = cue_times(cues[-1])
        is_last = segment_index == len(segment_starts) - 1
        analysis = EpisodeAnalysis(
            episode_number=starting_episode + segment_index,
            source_row_start=start_index + 2,
            source_row_end=end_index + 1,
            cue_count=len(cues),
            first_start=first_start,
            last_end=last_end,
            boundary_before="start_of_input" if segment_index == 0 else "timestamp_reset",
            boundary_after="end_of_input" if is_last else "timestamp_reset",
            partial_start=timestamp_to_seconds(first_start) > partial_start_after_seconds,
            completion_status=(
                "complete_source_track"
                if is_last and final_segment_complete
                else "unknown_end_of_input"
                if is_last
                else "closed_by_timestamp_reset"
            ),
        )
        segments.append(EpisodeSegment(analysis=analysis, cues=cues))
    return segments


def clean_cues(cues: tuple[SubtitleCue, ...]) -> list[SubtitleCue]:
    cleaned: list[SubtitleCue] = []
    for cue in cues:
        text = SAVE_PHRASE_PATTERN.sub("", cue.text).strip()
        if not text or text.casefold() in PLACEHOLDER_TEXTS:
            continue
        cleaned.append(
            SubtitleCue(
                identifier=str(len(cleaned) + 1),
                timing=cue.timing,
                text=text,
            )
        )
    return cleaned


async def translate_combined_csv_to_srt(
    data: bytes,
    *,
    source_file: str,
    translator: SubtitleTranslator,
    target_language: str,
    source_language: str,
    source_column: str | None = None,
    starting_episode: int = 1,
    reset_threshold_seconds: float = 10 * 60,
    include_incomplete_final: bool = False,
    final_segment_complete: bool = False,
    progress_callback: PipelineProgressCallback | None = None,
    checkpoint_directory: Path | None = None,
) -> TranslationPackage:
    segments = analyze_combined_csv(
        data,
        source_column=source_column,
        starting_episode=starting_episode,
        reset_threshold_seconds=reset_threshold_seconds,
        final_segment_complete=final_segment_complete,
    )
    translated_episodes: list[TranslatedEpisode] = []
    skipped_episodes: list[SkippedEpisode] = []
    translatable_segments = [
        segment
        for segment in segments
        if segment.analysis.completion_status != "unknown_end_of_input" or include_incomplete_final
    ]
    translated_index = 0
    for segment in segments:
        if (
            segment.analysis.completion_status == "unknown_end_of_input"
            and not include_incomplete_final
        ):
            skipped_episodes.append(
                SkippedEpisode(
                    analysis=segment.analysis,
                    reason="incomplete_final_capture",
                )
            )
            continue
        cleaned = clean_cues(segment.cues)
        if not cleaned:
            raise ValueError(f"Episode {segment.analysis.episode_number} has no translatable cues.")
        episode_index = translated_index
        translated_index += 1

        def forward_progress(
            event: TranslationProgress,
            *,
            current_index: int = episode_index,
            episode_number: int = segment.analysis.episode_number,
            episode_total: int = len(translatable_segments),
        ) -> None:
            if progress_callback is None:
                return
            overall = (current_index + event.fraction) / episode_total * 100
            progress_callback(
                PipelineProgress(
                    episode_number=episode_number,
                    stage=event.stage,
                    message=event.message,
                    overall_percent=overall,
                    completed=event.completed,
                    total=event.total,
                )
            )

        output_name = _episode_output_name(
            source_file,
            segment.analysis.episode_number,
            target_language,
        )
        checkpoint_path = None
        if checkpoint_directory is not None:
            checkpoint_path = checkpoint_directory / f"{Path(output_name).stem}.checkpoint.json"
        translation_result = await translator.translate_episode(
            cleaned,
            target_language=target_language,
            source_language=source_language,
            progress_callback=forward_progress,
            checkpoint_path=checkpoint_path,
        )
        translated_texts = list(translation_result.texts)
        if len(translated_texts) != len(cleaned):
            raise RuntimeError(
                f"Episode {segment.analysis.episode_number}: "
                "translator returned an incomplete result."
            )
        translated_cues = [
            SubtitleCue(
                identifier=str(index),
                timing=cue.timing,
                text=translated.strip(),
            )
            for index, (cue, translated) in enumerate(
                zip(cleaned, translated_texts, strict=True), start=1
            )
        ]
        quality_report_name = f"{Path(output_name).stem}.quality.json"
        translated_csv_name = f"{Path(output_name).with_suffix('').name}.csv"
        quality_report_content = _render_quality_report(
            episode_number=segment.analysis.episode_number,
            source_language=source_language,
            target_language=target_language,
            context=translation_result.context,
            issues=translation_result.issues,
            warnings=translation_result.warnings,
        )
        translated_episodes.append(
            TranslatedEpisode(
                analysis=segment.analysis,
                output_file=output_name,
                cue_count=len(translated_cues),
                content=SrtDocument(cues=translated_cues, newline="\r\n")
                .render()
                .encode("utf-8-sig"),
                quality_report_file=quality_report_name,
                quality_report_content=quality_report_content,
                issue_count=len(translation_result.issues),
                warnings=translation_result.warnings,
                translated_csv_file=translated_csv_name,
                translated_csv_content=_render_translated_csv(
                    cleaned,
                    translated_texts,
                    source_language=source_language,
                    target_language=target_language,
                ),
            )
        )
    return TranslationPackage(
        source_file=Path(source_file).name,
        source_language=source_language,
        target_language=target_language,
        episodes=tuple(translated_episodes),
        skipped_episodes=tuple(skipped_episodes),
    )


def write_translation_package(
    package: TranslationPackage,
    output_directory: Path,
    *,
    summary_filename: str = "episode_translation_summary.json",
) -> list[Path]:
    output_directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for episode in package.episodes:
        path = output_directory / episode.output_file
        path.write_bytes(episode.content)
        written.append(path)
        quality_path = output_directory / episode.quality_report_file
        quality_path.write_bytes(episode.quality_report_content)
        written.append(quality_path)
        translated_csv_path = output_directory / episode.translated_csv_file
        translated_csv_path.write_bytes(episode.translated_csv_content)
        written.append(translated_csv_path)

    summary_path = output_directory / summary_filename
    summary_path.write_text(
        json.dumps(
            {
                "source_file": package.source_file,
                "source_language": package.source_language,
                "target_language": package.target_language,
                "episodes": [
                    {
                        **asdict(episode.analysis),
                        "output_file": episode.output_file,
                        "translated_cue_count": episode.cue_count,
                        "translation_status": "translated",
                        "quality_report_file": episode.quality_report_file,
                        "translated_csv_file": episode.translated_csv_file,
                        "quality_issue_count": episode.issue_count,
                        "warnings": list(episode.warnings),
                    }
                    for episode in package.episodes
                ]
                + [
                    {
                        **asdict(episode.analysis),
                        "output_file": None,
                        "translated_cue_count": 0,
                        "translation_status": "skipped_incomplete",
                        "skip_reason": episode.reason,
                    }
                    for episode in package.skipped_episodes
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    written.append(summary_path)
    return written


def _is_confirmed_progression(starts: list[float], index: int, confirmation_cues: int) -> bool:
    confirmation = starts[index : min(len(starts), index + max(1, confirmation_cues))]
    return all(
        current >= previous
        for previous, current in zip(confirmation, confirmation[1:], strict=False)
    )


def _episode_output_name(source_file: str, episode_number: int, language: str) -> str:
    source_stem = Path(source_file).stem
    language_slug = re.sub(r"[^a-z0-9]+", "-", language.casefold()).strip("-")
    return f"{source_stem}.ep{episode_number:02d}.{language_slug or 'translated'}.srt"


def _render_quality_report(
    *,
    episode_number: int,
    source_language: str,
    target_language: str,
    context: dict[str, object],
    issues: tuple[TranslationIssue, ...],
    warnings: tuple[str, ...],
) -> bytes:
    return json.dumps(
        {
            "episode_number": episode_number,
            "source_language": source_language,
            "target_language": target_language,
            "episode_context": context,
            "quality_summary": {
                "flagged_cue_count": len(issues),
                "warnings": list(warnings),
                "human_review_recommended": bool(issues or warnings),
            },
            "difficult_or_corrected_cues": [asdict(issue) for issue in issues],
        },
        ensure_ascii=False,
        indent=2,
    ).encode("utf-8")


def _render_translated_csv(
    cues: list[SubtitleCue],
    translated_texts: list[str],
    *,
    source_language: str,
    target_language: str,
) -> bytes:
    source_column = target_column_for_language(source_language)
    target_column = target_column_for_language(target_language)
    if source_column == target_column:
        source_column = "Subtitle_SOURCE"
    stream = io.StringIO(newline="")
    fields = ["Cue_ID", "St", "Et", source_column, target_column]
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\r\n")
    writer.writeheader()
    for cue, translated in zip(cues, translated_texts, strict=True):
        start, end = cue_times(cue)
        writer.writerow(
            {
                "Cue_ID": cue.identifier,
                "St": start,
                "Et": end,
                source_column: cue.text,
                target_column: translated.strip(),
            }
        )
    return stream.getvalue().encode("utf-8-sig")
