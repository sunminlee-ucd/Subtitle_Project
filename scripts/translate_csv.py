from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path

from app.config import Settings
from app.csv_subtitles import parse_subtitle_csv, target_column_for_language
from app.translator import OpenAITranslator, create_batches


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Translate a timed subtitle CSV with OpenAI.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--target-language", default="Persian (Farsi)")
    parser.add_argument("--source-language", default="Korean")
    parser.add_argument("--source-column", default="Subtitle_KO")
    parser.add_argument("--model", default=None)
    parser.add_argument("--review-model", default=None)
    return parser.parse_args()


async def translate_csv(args: argparse.Namespace) -> None:
    settings = Settings.from_environment()
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is not set.")

    source_bytes = args.input.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    document = parse_subtitle_csv(source_bytes, source_column=args.source_column)
    output_column = target_column_for_language(args.target_language)
    checkpoint_path = args.output.with_suffix(args.output.suffix + ".checkpoint.json")
    translations = load_checkpoint(checkpoint_path, source_hash)

    translator = OpenAITranslator(
        api_key=api_key,
        model=args.model or settings.openai_model,
        review_model=args.review_model or settings.openai_review_model,
        batch_character_limit=settings.translation_batch_characters,
        max_concurrent_requests=settings.translation_concurrency,
    )
    batches = create_batches(document.cues, settings.translation_batch_characters)
    print(
        f"Translating {len(document.cues)} rows in {len(batches)} batches "
        f"with {args.model or settings.openai_model}."
    )

    for batch_number, batch in enumerate(batches, start=1):
        missing = [cue for cue in batch if cue.identifier not in translations]
        if missing:
            batch_translations = await translator.translate(
                missing,
                target_language=args.target_language,
                source_language=args.source_language,
            )
            translations.update(
                {
                    cue.identifier: translated
                    for cue, translated in zip(missing, batch_translations, strict=True)
                }
            )
            save_checkpoint(checkpoint_path, source_hash, translations)
        print(f"Batch {batch_number}/{len(batches)} complete ({len(translations)} rows).")

    ordered = [translations[cue.identifier] for cue in document.cues]
    document.add_translations(ordered, output_column)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(document.render())
    print(f"Saved {args.output} with column {output_column}.")


def load_checkpoint(path: Path, source_hash: str) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if payload.get("source_sha256") != source_hash:
        return {}
    return {str(key): str(value) for key, value in payload.get("translations", {}).items()}


def save_checkpoint(path: Path, source_hash: str, translations: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"source_sha256": source_hash, "translations": translations},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    asyncio.run(translate_csv(parse_args()))
