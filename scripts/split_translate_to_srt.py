from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from app.config import Settings
from app.episode_pipeline import (
    PipelineProgress,
    analyze_combined_csv,
    translate_combined_csv_to_srt,
    write_translation_package,
)
from app.translator import OpenAITranslator


def show_progress(event: PipelineProgress) -> None:
    count = f" {event.completed}/{event.total}" if event.total else ""
    print(
        f"[{event.overall_percent:5.1f}%] Episode {event.episode_number} "
        f"{event.stage}:{count} {event.message}",
        flush=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Split a combined timed CSV into episodes and translate each episode to SRT."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("output") / "episodes")
    parser.add_argument("--start-episode", type=int, default=1)
    parser.add_argument("--source-language", default="Korean")
    parser.add_argument("--target-language", default="Persian (Farsi)")
    parser.add_argument("--source-column", default=None)
    parser.add_argument("--reset-minutes", type=float, default=10.0)
    parser.add_argument("--model", default=None)
    parser.add_argument("--review-model", default=None)
    parser.add_argument("--analyze-only", action="store_true")
    parser.add_argument(
        "--include-incomplete-final",
        action="store_true",
        help="Translate the unconfirmed final segment. By default it is skipped.",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    data = args.input.read_bytes()
    segments = analyze_combined_csv(
        data,
        source_column=args.source_column,
        starting_episode=args.start_episode,
        reset_threshold_seconds=args.reset_minutes * 60,
    )
    for segment in segments:
        analysis = segment.analysis
        action = (
            "translate"
            if analysis.completion_status != "unknown_end_of_input" or args.include_incomplete_final
            else "skip_incomplete"
        )
        print(
            f"Episode {analysis.episode_number}: rows {analysis.source_row_start}-"
            f"{analysis.source_row_end}, {analysis.cue_count} cues, "
            f"{analysis.first_start} -> {analysis.last_end}, "
            f"status={analysis.completion_status}, action={action}"
        )
    if args.analyze_only:
        return

    settings = Settings.from_environment()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is not set.")
    translator = OpenAITranslator(
        api_key=api_key,
        model=args.model or settings.openai_model,
        review_model=args.review_model or settings.openai_review_model,
        batch_character_limit=settings.translation_batch_characters,
        max_concurrent_requests=settings.translation_concurrency,
    )
    package = await translate_combined_csv_to_srt(
        data,
        source_file=args.input.name,
        translator=translator,
        target_language=args.target_language,
        source_language=args.source_language,
        source_column=args.source_column,
        starting_episode=args.start_episode,
        reset_threshold_seconds=args.reset_minutes * 60,
        include_incomplete_final=args.include_incomplete_final,
        progress_callback=show_progress,
    )
    written = write_translation_package(package, args.output_dir.resolve())
    for path in written:
        print(f"Saved {path}")


if __name__ == "__main__":
    asyncio.run(main())
