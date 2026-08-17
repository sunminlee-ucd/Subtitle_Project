from app.srt import SubtitleCue
from app.study_guide import format_study_time, render_study_guide


def test_format_study_time_removes_milliseconds_and_unused_hours() -> None:
    assert format_study_time("00:01:23,456") == "01:23"
    assert format_study_time("01:02:03.999") == "1:02:03"


def test_render_study_guide_contains_source_translation_and_print_layout() -> None:
    content = render_study_guide(
        [
            SubtitleCue(
                identifier="1",
                timing="00:01:23,456 --> 00:01:25,100",
                text="Original <line>",
            )
        ],
        ["Translated line"],
        source_language="English",
        target_language="Persian (Farsi)",
        title="Episode 01 Study Guide",
    ).decode("utf-8")

    assert "01:23" in content
    assert "00:01:23,456" not in content
    assert "Original &lt;line&gt;" in content
    assert "Translated line" in content
    assert 'dir="rtl"' in content
    assert "@media print" in content
