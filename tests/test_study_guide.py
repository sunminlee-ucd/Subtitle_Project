from app.srt import SubtitleCue
from app.study_guide import format_study_time, render_study_pdf


def test_format_study_time_removes_milliseconds_and_unused_hours() -> None:
    assert format_study_time("00:01:23,456") == "01:23"
    assert format_study_time("01:02:03.999") == "1:02:03"


def test_render_study_pdf_creates_real_pdf_with_table_content() -> None:
    content = render_study_pdf(
        [
            SubtitleCue(
                identifier="1",
                timing="00:01:23,456 --> 00:01:25,100",
                text="Original line",
            ),
            SubtitleCue(
                identifier="2",
                timing="00:01:28,000 --> 00:01:31,000",
                text="A longer original subtitle that should wrap inside its table cell.",
            ),
        ],
        [
            "Translated line",
            "A longer translated subtitle that should wrap inside its table cell.",
        ],
        source_language="English",
        target_language="English",
        title="Episode 01 Study Guide",
    )

    assert content.startswith(b"%PDF-")
    assert len(content) > 2_000
