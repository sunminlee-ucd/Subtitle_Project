from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from app.config import Settings
from app.folder_workflow import translate_input_folder
from app.translator import EchoTranslator, OpenAITranslator

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Translate every SRT and timed CSV in the input folder."
    )
    parser.add_argument("--input-dir", type=Path, default=PROJECT_ROOT / "input")
    parser.add_argument("--output-dir", type=Path, default=PROJECT_ROOT / "output")
    parser.add_argument("--target-language", default="Persian (Farsi)")
    parser.add_argument("--source-language", default="Korean")
    parser.add_argument("--source-column", default="Subtitle_KO")
    parser.add_argument("--model", default=None)
    parser.add_argument("--review-model", default=None)
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    settings = Settings.from_environment()
    if settings.translation_provider == "echo":
        translator = EchoTranslator()
    else:
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

    try:
        results = await translate_input_folder(
            input_directory=args.input_dir.resolve(),
            output_directory=args.output_dir.resolve(),
            translator=translator,
            target_language=args.target_language,
            source_language=args.source_language,
            source_column=args.source_column,
            max_files=settings.max_files,
            max_file_size_bytes=settings.max_file_size_bytes,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc

    for result in results:
        print(f"{result.source_file} -> {result.output_file} ({result.cue_count} cues)")
    print(f"Completed {len(results)} file(s). Results: {args.output_dir.resolve()}")


if __name__ == "__main__":
    asyncio.run(main())
