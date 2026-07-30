import pytest

from app.srt import SubtitleCue
from app.translator import TranslationError, _parse_translation_response, create_batches


def test_batches_keep_all_cues_in_order() -> None:
    cues = [
        SubtitleCue(identifier=str(index), timing="00:00:00,000 --> 00:00:01,000", text="x" * 20)
        for index in range(1, 8)
    ]

    batches = create_batches(cues, character_limit=100)

    assert len(batches) > 1
    assert [cue.identifier for batch in batches for cue in batch] == [
        str(index) for index in range(1, 8)
    ]


def test_parses_fenced_json_response() -> None:
    result = _parse_translation_response(
        '```json\n{"translations":[{"id":"1","text":"سلام"}]}\n```'
    )
    assert result[0].identifier == "1"
    assert result[0].text == "سلام"


def test_rejects_invalid_provider_response() -> None:
    with pytest.raises(TranslationError):
        _parse_translation_response("not json")
