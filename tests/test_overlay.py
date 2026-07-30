from pathlib import Path

from desktop.overlay import format_position, load_csv_cues, timestamp_to_seconds


def test_overlay_loads_persian_column_first(tmp_path: Path) -> None:
    csv_path = tmp_path / "translated.csv"
    csv_path.write_text(
        'St,Et,Subtitle_KO,Subtitle_FA\n"00:00:01,250","00:00:03,500",안녕하세요,سلام\n',
        encoding="utf-8-sig",
    )

    cues, column = load_csv_cues(csv_path)

    assert column == "Subtitle_FA"
    assert cues[0].start == 1.25
    assert cues[0].text == "سلام"


def test_overlay_time_conversion() -> None:
    assert timestamp_to_seconds("01:02:03,500") == 3723.5
    assert format_position(3723.5) == "01:02:03.500"
