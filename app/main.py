from __future__ import annotations

import io
import json
import re
import zipfile
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import Settings
from app.csv_subtitles import (
    CsvSubtitleError,
    parse_subtitle_csv,
    target_column_for_language,
)
from app.srt import SrtParseError, parse_srt
from app.translator import EchoTranslator, OpenAITranslator, SubtitleTranslator, TranslationError

BASE_DIR = Path(__file__).resolve().parent
SAFE_LANGUAGE_PATTERN = re.compile(r"^[\w .(),'\-/]{2,80}$", re.UNICODE)

app = FastAPI(
    title="Subtitle Project API",
    version="0.1.0",
    description="Translate multiple SRT files while preserving subtitle timing.",
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@lru_cache
def get_settings() -> Settings:
    return Settings.from_environment()


def get_translator(settings: Annotated[Settings, Depends(get_settings)]) -> SubtitleTranslator:
    if settings.translation_provider == "echo":
        return EchoTranslator()
    if settings.translation_provider != "openai":
        raise HTTPException(status_code=500, detail="Unsupported translation provider.")
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not configured on the server.",
        )
    return OpenAITranslator(
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        batch_character_limit=settings.translation_batch_characters,
    )


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str]:
    configured = settings.translation_provider == "echo" or bool(settings.openai_api_key)
    return {
        "status": "ok",
        "provider": settings.translation_provider,
        "model": settings.openai_model,
        "translation_ready": str(configured).lower(),
    }


@app.post("/api/translations", response_class=StreamingResponse)
async def translate_files(
    files: Annotated[list[UploadFile], File(description="One or more UTF-8 SRT or CSV files")],
    target_language: Annotated[str, Form(min_length=2, max_length=80)],
    settings: Annotated[Settings, Depends(get_settings)],
    translator: Annotated[SubtitleTranslator, Depends(get_translator)],
    source_language: Annotated[str | None, Form(max_length=80)] = None,
    source_column: Annotated[str | None, Form(max_length=80)] = None,
) -> StreamingResponse:
    target_language = _validate_language(target_language, "target")
    if source_language:
        source_language = _validate_language(source_language, "source")
    if not files:
        raise HTTPException(status_code=400, detail="Select at least one SRT file.")
    if len(files) > settings.max_files:
        raise HTTPException(
            status_code=400,
            detail=f"A maximum of {settings.max_files} files can be translated at once.",
        )

    output = io.BytesIO()
    summary: list[dict[str, object]] = []
    used_names: set[str] = set()

    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for uploaded in files:
            original_name = Path(uploaded.filename or "subtitle.srt").name
            suffix = Path(original_name).suffix.lower()
            if suffix not in {".srt", ".csv"}:
                raise HTTPException(
                    status_code=400,
                    detail=f"{original_name}: only .srt and .csv files are supported.",
                )

            content = await _read_limited(uploaded, settings.max_file_size_bytes)
            try:
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
            except (SrtParseError, CsvSubtitleError) as exc:
                raise HTTPException(status_code=400, detail=f"{original_name}: {exc}") from exc
            except TranslationError as exc:
                raise HTTPException(status_code=502, detail=f"{original_name}: {exc}") from exc

            if len(translated_texts) != len(document.cues):
                raise HTTPException(
                    status_code=502,
                    detail=f"{original_name}: AI returned an incomplete translation.",
                )
            output_column = None
            if suffix == ".srt":
                for cue, translated_text in zip(document.cues, translated_texts, strict=True):
                    cue.text = translated_text.strip()
                rendered_content = document.render().encode("utf-8-sig")
            else:
                output_column = target_column_for_language(target_language)
                document.add_translations(translated_texts, output_column)
                rendered_content = document.render()

            output_name = _unique_output_name(original_name, target_language, used_names)
            archive.writestr(output_name, rendered_content)
            summary.append(
                {
                    "source_file": original_name,
                    "output_file": output_name,
                    "cue_count": len(document.cues),
                    "source_column": getattr(document, "source_column", None),
                    "output_column": output_column,
                }
            )

        archive.writestr(
            "translation_summary.json",
            json.dumps(
                {
                    "target_language": target_language,
                    "source_language": source_language or "auto-detect",
                    "translated_at": datetime.now(UTC).isoformat(),
                    "files": summary,
                },
                ensure_ascii=False,
                indent=2,
            ).encode("utf-8"),
        )

    output.seek(0)
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    headers = {"Content-Disposition": f'attachment; filename="translated-srt-{timestamp}.zip"'}
    return StreamingResponse(output, media_type="application/zip", headers=headers)


def _validate_language(value: str, field_name: str) -> str:
    normalized = " ".join(value.strip().split())
    if not SAFE_LANGUAGE_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=422,
            detail=f"The {field_name} language contains unsupported characters.",
        )
    return normalized


async def _read_limited(uploaded: UploadFile, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    async for chunk in _upload_chunks(uploaded):
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"{Path(uploaded.filename or 'file').name}: file is too large.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _upload_chunks(uploaded: UploadFile) -> AsyncIterator[bytes]:
    while chunk := await uploaded.read(64 * 1024):
        yield chunk


def _unique_output_name(original: str, language: str, used_names: set[str]) -> str:
    stem = Path(original).stem
    suffix = Path(original).suffix.lower()
    language_slug = re.sub(r"[^\w-]+", "-", language.lower(), flags=re.UNICODE).strip("-")
    candidate = f"{stem}.{language_slug}{suffix}"
    counter = 2
    while candidate.lower() in used_names:
        candidate = f"{stem}.{language_slug}-{counter}{suffix}"
        counter += 1
    used_names.add(candidate.lower())
    return candidate
