import csv
import io

import pytest

from app.csv_subtitles import (
    CsvSubtitleError,
    parse_subtitle_csv,
    target_column_for_language,
)

SAMPLE_CSV = (
    "St,Et,Subtitle,Subtitle_KO\r\n"
    '"00:00:01,000","00:00:03,500",Hello,안녕하세요\r\n'
    '"00:00:04,000","00:00:06,000",Goodbye,안녕히 가세요\r\n'
).encode()


def test_parse_csv_prefers_korean_and_adds_persian_column() -> None:
    document = parse_subtitle_csv(SAMPLE_CSV)

    assert document.source_column == "Subtitle_KO"
    assert [cue.text for cue in document.cues] == ["안녕하세요", "안녕히 가세요"]
    assert target_column_for_language("Persian (Farsi)") == "Subtitle_FA"

    document.add_translations(["سلام", "خداحافظ"], "Subtitle_FA")
    rendered = document.render().decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(rendered)))
    assert rows[0]["Subtitle"] == "Hello"
    assert rows[0]["Subtitle_FA"] == "سلام"


def test_csv_rejects_missing_time_columns() -> None:
    with pytest.raises(CsvSubtitleError, match="missing the 'St'"):
        parse_subtitle_csv(b"Subtitle_KO\nhello\n")
