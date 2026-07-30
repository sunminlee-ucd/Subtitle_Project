import pytest

from app.srt import SrtParseError, parse_srt

SAMPLE = b"""1\r
00:00:01,000 --> 00:00:03,500\r
Hello, world.\r
\r
2\r
00:00:04,000 --> 00:00:06,000 align:start\r
Second line\r
continues here.\r
"""


def test_parse_and_render_preserves_timing_and_newline() -> None:
    document = parse_srt(SAMPLE)

    assert len(document.cues) == 2
    assert document.cues[1].timing == "00:00:04,000 --> 00:00:06,000 align:start"
    assert document.cues[1].text == "Second line\ncontinues here."

    document.cues[0].text = "سلام دنیا."
    rendered = document.render()
    assert "00:00:01,000 --> 00:00:03,500\r\nسلام دنیا." in rendered


def test_rejects_invalid_timestamp() -> None:
    with pytest.raises(SrtParseError, match="invalid timestamp"):
        parse_srt(b"1\nnot-a-time\nHello\n")
