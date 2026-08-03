import json
from pathlib import Path

import pytest

from app.episode_pipeline import (
    analyze_combined_csv,
    translate_combined_csv_to_srt,
    write_translation_package,
)
from app.srt import parse_srt
from app.translator import EchoTranslator
from desktop.subtitle_processor import load_private_api_key

SAMPLE = """St,Et,Subtitle
"00:00:11,073","00:00:12,000",- The first subtitle has not started yet. -
"00:10:00,000","00:10:02,000",첫 대사 Save Phrase
"01:08:57,947","01:09:00,332",3화 마지막 Save Phrase
"00:09:13,203","00:09:14,660",4화 첫 데이터 Save Phrase
"00:09:20,000","00:09:22,000",다음 대사
"00:14:27,000","00:14:28,559",현재 캡처 마지막
""".encode()


def test_private_api_key_loader_accepts_raw_and_env_formats(tmp_path: Path) -> None:
    key_path = tmp_path / "API key for openAI.txt"
    key_path.write_text("sk-test-placeholder", encoding="utf-8")
    assert load_private_api_key(key_path) == "sk-test-placeholder"

    key_path.write_text('OPENAI_API_KEY="sk-test-env-placeholder"', encoding="utf-8")
    assert load_private_api_key(key_path) == "sk-test-env-placeholder"


def test_analyze_detects_reset_and_preserves_partial_last_episode() -> None:
    segments = analyze_combined_csv(SAMPLE, starting_episode=3)

    assert [segment.analysis.episode_number for segment in segments] == [3, 4]
    assert segments[0].analysis.source_row_start == 2
    assert segments[0].analysis.source_row_end == 4
    assert segments[0].analysis.completion_status == "closed_by_timestamp_reset"
    assert segments[1].analysis.source_row_start == 5
    assert segments[1].analysis.source_row_end == 7
    assert segments[1].analysis.partial_start is True
    assert segments[1].analysis.completion_status == "unknown_end_of_input"


def test_analyze_supports_any_number_of_episode_resets() -> None:
    rows = ["St,Et,Subtitle"]
    for number in range(4):
        rows.extend(
            [
                f'"00:00:10,000","00:00:11,000",episode {number} start',
                f'"00:30:00,000","00:30:01,000",episode {number} middle',
                f'"01:00:00,000","01:00:01,000",episode {number} end',
            ]
        )

    segments = analyze_combined_csv("\n".join(rows).encode(), starting_episode=3)

    assert [segment.analysis.episode_number for segment in segments] == [3, 4, 5, 6]


@pytest.mark.asyncio
async def test_translate_skips_incomplete_final_episode(tmp_path: Path) -> None:
    progress = []
    package = await translate_combined_csv_to_srt(
        SAMPLE,
        source_file="captured_subs.csv",
        translator=EchoTranslator(),
        target_language="Persian (Farsi)",
        source_language="Korean",
        starting_episode=3,
        progress_callback=progress.append,
    )
    written = write_translation_package(package, tmp_path)

    assert [episode.output_file for episode in package.episodes] == [
        "captured_subs.ep03.persian-farsi.srt",
    ]
    assert [episode.analysis.episode_number for episode in package.skipped_episodes] == [4]
    episode_three = parse_srt(written[0].read_bytes())
    assert len(episode_three.cues) == 2
    assert "Save Phrase" not in episode_three.cues[0].text
    assert "first subtitle has not started" not in episode_three.render()
    quality_report = json.loads(written[1].read_text(encoding="utf-8"))
    assert quality_report["quality_summary"]["flagged_cue_count"] == 0
    assert progress[-1].overall_percent == 100
    summary = json.loads(written[-1].read_text(encoding="utf-8"))
    assert summary["episodes"][-1]["completion_status"] == "unknown_end_of_input"
    assert summary["episodes"][-1]["translation_status"] == "skipped_incomplete"


@pytest.mark.asyncio
async def test_incomplete_final_episode_can_be_explicitly_included() -> None:
    package = await translate_combined_csv_to_srt(
        SAMPLE,
        source_file="captured_subs.csv",
        translator=EchoTranslator(),
        target_language="Persian (Farsi)",
        source_language="Korean",
        starting_episode=3,
        include_incomplete_final=True,
    )

    assert [episode.analysis.episode_number for episode in package.episodes] == [3, 4]
    assert package.skipped_episodes == ()
