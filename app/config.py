from __future__ import annotations

import os
from dataclasses import dataclass


def _positive_int(name: str, default: int) -> int:
    raw_value = os.getenv(name, str(default))
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value <= 0:
        raise RuntimeError(f"{name} must be greater than zero")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    openai_api_key: str | None
    openai_model: str
    translation_provider: str
    max_files: int
    max_file_size_bytes: int
    translation_batch_characters: int

    @classmethod
    def from_environment(cls) -> Settings:
        return cls(
            openai_api_key=os.getenv("OPENAI_API_KEY") or None,
            openai_model=os.getenv("OPENAI_MODEL", "gpt-5.6"),
            translation_provider=os.getenv("TRANSLATION_PROVIDER", "openai").lower(),
            max_files=_positive_int("MAX_FILES", 20),
            max_file_size_bytes=_positive_int("MAX_FILE_SIZE_BYTES", 5 * 1024 * 1024),
            translation_batch_characters=_positive_int("TRANSLATION_BATCH_CHARACTERS", 8000),
        )
