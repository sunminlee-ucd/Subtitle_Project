from __future__ import annotations

import json

import pytest

from app.folder_workflow import subtitle_files, translate_input_folder
from app.translator import EchoTranslator


@pytest.mark.asyncio
async def test_translates_input_folder_to_output_folder(tmp_path) -> None:
    input_directory = tmp_path / "input"
    output_directory = tmp_path / "output"
    input_directory.mkdir()
    input_directory.joinpath("episode.csv").write_text(
        'St,Et,Subtitle_KO\n"00:00:01,000","00:00:03,000",안녕하세요\n',
        encoding="utf-8",
    )
    input_directory.joinpath("episode.srt").write_text(
        "1\n00:00:01,000 --> 00:00:03,000\nHello\n",
        encoding="utf-8",
    )
    input_directory.joinpath("notes.txt").write_text("ignored", encoding="utf-8")

    results = await translate_input_folder(
        input_directory=input_directory,
        output_directory=output_directory,
        translator=EchoTranslator(),
        target_language="Persian (Farsi)",
        source_language="Korean",
        source_column="Subtitle_KO",
    )

    assert [result.output_file for result in results] == [
        "episode.persian-farsi.csv",
        "episode.persian-farsi.srt",
    ]
    assert "Subtitle_FA" in output_directory.joinpath("episode.persian-farsi.csv").read_text(
        encoding="utf-8-sig"
    )
    summary = json.loads(
        output_directory.joinpath("translation_summary.json").read_text(encoding="utf-8")
    )
    assert len(summary["files"]) == 2


def test_empty_input_folder_is_reported(tmp_path) -> None:
    input_directory = tmp_path / "input"
    input_directory.mkdir()
    assert subtitle_files(input_directory) == []
