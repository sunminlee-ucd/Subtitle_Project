from pathlib import Path

import pytest

from app.csv_subtitles import parse_subtitle_csv
from app.episode_pipeline import (
    analyze_combined_csv,
    translate_combined_csv_to_srt,
    write_translation_package,
)
from app.translator import EchoTranslator
from app.ttml import parse_ttml
from desktop.subtitle_processor import episode_number_from_filename

NETFLIX_TTML = b"""<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"
    xmlns:ttp="http://www.w3.org/ns/ttml#parameter"
    xmlns:xml="http://www.w3.org/XML/1998/namespace"
    ttp:tickRate="10000000" xml:lang="ko">
  <body><div>
    <p begin="10000000t" end="25000000t"><span>Hello</span><br/><span>world</span></p>
    <p begin="30000000t" end="40000000t"><span>Goodbye</span></p>
  </div></body>
</tt>
"""


def file_count(directory: Path, pattern: str) -> int:
    return len(list(directory.glob(pattern)))


def test_netflix_ttml_converts_to_timed_csv_with_line_breaks() -> None:
    document = parse_ttml(NETFLIX_TTML)

    assert document.language == "ko"
    assert document.source_column == "Subtitle_KO"
    assert document.cues[0].timing == "00:00:01,000 --> 00:00:02,500"
    assert document.cues[0].text == "Hello\nworld"

    csv_document = parse_subtitle_csv(document.render_csv())
    assert len(csv_document.cues) == 2
    assert csv_document.cues[0].text == "Hello\nworld"


def test_full_ttml_track_marks_final_episode_complete() -> None:
    document = parse_ttml(NETFLIX_TTML)
    segments = analyze_combined_csv(
        document.render_csv(),
        final_segment_complete=True,
    )

    assert len(segments) == 1
    assert segments[0].analysis.completion_status == "complete_source_track"


def test_episode_number_is_read_from_download_filename() -> None:
    assert episode_number_from_filename("Teach You a Lesson - E4 Episode 4 - ko.ttml", 1) == 4
    assert episode_number_from_filename("Movie Title - ko.ttml", 7) == 7


@pytest.mark.asyncio
async def test_multiple_ttml_files_create_separate_srt_and_csv_outputs(tmp_path: Path) -> None:
    for episode_number in (4, 5):
        source_file = f"Teach You a Lesson - E{episode_number} Episode {episode_number} - ko.ttml"
        document = parse_ttml(NETFLIX_TTML)
        package = await translate_combined_csv_to_srt(
            document.render_csv(),
            source_file=source_file,
            translator=EchoTranslator(),
            target_language="Persian (Farsi)",
            source_language="Korean",
            source_column=document.source_column,
            starting_episode=episode_number,
            final_segment_complete=True,
        )
        write_translation_package(
            package,
            tmp_path,
            summary_filename=f"episode-{episode_number}.summary.json",
        )

    assert file_count(tmp_path, "*.srt") == 2
    assert file_count(tmp_path, "*.persian-farsi.csv") == 2
    assert file_count(tmp_path, "*.summary.json") == 2
