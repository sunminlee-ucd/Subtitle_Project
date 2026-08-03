import asyncio

import pytest

from app.srt import SubtitleCue
from app.translator import (
    DraftTranslationOutput,
    DraftTranslationRow,
    EpisodeContextOutput,
    OpenAITranslator,
    RetryTranslationOutput,
    RetryTranslationRow,
    ReviewTranslationRow,
    TranslationError,
    _build_quality_issues,
    _parse_translation_response,
    create_batches,
    estimate_translation_cost,
    sample_cues_for_context,
)


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


def test_difficult_cue_records_retry_and_review_resolution() -> None:
    cue = SubtitleCue(
        identifier="1",
        timing="00:00:00,000 --> 00:00:01,000",
        text="ambiguous source",
    )
    issues = _build_quality_issues(
        [cue],
        {
            "1": DraftTranslationRow(
                id="1",
                text="draft",
                confidence="low",
                needs_attention=True,
                difficulty_reason="omitted subject",
            )
        },
        {
            "1": RetryTranslationRow(
                id="1",
                text="contextual translation",
                confidence="medium",
                interpretation="speaker inferred from context",
                resolution="Ambiguity was preserved without adding a name.",
            )
        },
        {
            "1": ReviewTranslationRow(
                id="1",
                text="final contextual translation",
                confidence="medium",
                problem="source remains ambiguous",
                correction_reason="Adjusted tone during review.",
            )
        },
    )

    assert issues[0].action == "retranslated_with_episode_context_then_reviewed"
    assert issues[0].confidence == "medium"
    assert "preserved" in issues[0].resolution


@pytest.mark.asyncio
async def test_quality_pipeline_retries_difficult_cue_and_reviews(monkeypatch) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        review_model="gpt-5.6-terra",
        batch_character_limit=1000,
    )
    cues = [
        SubtitleCue(
            identifier="1",
            timing="00:00:00,000 --> 00:00:01,000",
            text="ambiguous source",
        )
    ]

    async def analyze(*_args):
        return EpisodeContextOutput(
            summary="A tense conversation.",
            overall_tone="tense",
            register_and_formality="formal",
            cultural_notes=[],
            characters=[],
            terminology=[],
            consistency_rules=["Preserve formality."],
        )

    async def draft(*_args):
        return DraftTranslationOutput(
            translations=[
                DraftTranslationRow(
                    id="1",
                    text="draft",
                    confidence="low",
                    needs_attention=True,
                    difficulty_reason="omitted subject",
                )
            ]
        )

    async def retry(*_args):
        return RetryTranslationOutput(
            translations=[
                RetryTranslationRow(
                    id="1",
                    text="contextual draft",
                    confidence="medium",
                    interpretation="subject inferred",
                    resolution="Ambiguity preserved.",
                )
            ]
        )

    monkeypatch.setattr(translator, "_analyze_context", analyze)
    monkeypatch.setattr(translator, "_translate_batch", draft)
    monkeypatch.setattr(translator, "_retry_difficult", retry)
    progress = []

    result = await translator.translate_episode(
        cues,
        "Persian (Farsi)",
        "Korean",
        progress_callback=progress.append,
    )

    assert result.texts == ("contextual draft",)
    assert result.issues[0].action == "retranslated_with_episode_context_then_reviewed"
    assert result.context["model_routing"] == {
        "primary_model": "gpt-5-mini",
        "escalation_model": "gpt-5.6-terra",
        "escalated_cue_count": 1,
        "maximum_review_fraction": 0.15,
    }
    assert [event.stage for event in progress] == [
        "context",
        "context",
        "draft_translation",
        "draft_translation",
        "difficult_cues",
        "difficult_cues",
    ]


@pytest.mark.asyncio
async def test_draft_translation_ignores_ids_and_uses_timed_input_order(monkeypatch) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=1000,
    )
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text=f"source {index}",
        )
        for index in range(1, 4)
    ]

    async def analyze(*_args):
        return EpisodeContextOutput(
            summary="Context",
            overall_tone="neutral",
            register_and_formality="neutral",
            cultural_notes=[],
            characters=[],
            terminology=[],
            consistency_rules=[],
        )

    async def draft_with_unreliable_ids(batch, *_args):
        return DraftTranslationOutput(
            translations=[
                DraftTranslationRow(
                    id=f"ignored-{len(batch) - index}",
                    text=f"translated {cue.identifier}",
                    confidence="high",
                    needs_attention=False,
                    difficulty_reason="",
                )
                for index, cue in enumerate(batch)
            ]
        )

    monkeypatch.setattr(translator, "_analyze_context", analyze)
    monkeypatch.setattr(translator, "_translate_batch", draft_with_unreliable_ids)

    result = await translator.translate_episode(cues, "Persian (Farsi)", "Korean")

    assert result.texts == ("translated 1", "translated 2", "translated 3")
    assert result.warnings == ()


@pytest.mark.asyncio
async def test_draft_translation_splits_only_the_mismatched_batch(monkeypatch) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=1000,
    )
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text=f"source {index}",
        )
        for index in range(1, 5)
    ]
    requested_ids = []

    async def analyze(*_args):
        return EpisodeContextOutput(
            summary="Context",
            overall_tone="neutral",
            register_and_formality="neutral",
            cultural_notes=[],
            characters=[],
            terminology=[],
            consistency_rules=[],
        )

    async def incomplete_then_valid(batch, *_args):
        requested_ids.append([cue.identifier for cue in batch])
        returned = batch[:-1] if len(batch) == 4 else batch
        return DraftTranslationOutput(
            translations=[
                DraftTranslationRow(
                    id=cue.identifier,
                    text=f"translated {cue.identifier}",
                    confidence="high",
                    needs_attention=False,
                    difficulty_reason="",
                )
                for cue in returned
            ]
        )

    monkeypatch.setattr(translator, "_analyze_context", analyze)
    monkeypatch.setattr(translator, "_translate_batch", incomplete_then_valid)
    progress = []

    result = await translator.translate_episode(
        cues,
        "Persian (Farsi)",
        "Korean",
        progress_callback=progress.append,
    )

    assert result.texts == tuple(f"translated {index}" for index in range(1, 5))
    assert requested_ids == [["1", "2", "3", "4"], ["1", "2"], ["3", "4"]]
    assert "2 smaller targeted translation request(s)" in result.warnings[0]
    assert "incomplete AI structured output" in result.warnings[0]
    assert "draft_recovery" in [event.stage for event in progress]


@pytest.mark.asyncio
async def test_truncated_structured_json_retries_as_smaller_batches(monkeypatch) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=1000,
    )
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text=f"source {index}",
        )
        for index in range(1, 5)
    ]
    requested_sizes = []

    async def analyze(*_args):
        return EpisodeContextOutput(
            summary="Context",
            overall_tone="neutral",
            register_and_formality="neutral",
            cultural_notes=[],
            characters=[],
            terminology=[],
            consistency_rules=[],
        )

    async def truncated_then_valid(batch, *_args):
        requested_sizes.append(len(batch))
        if len(batch) == 4:
            raise TranslationError(
                "AI draft translation request failed: validation error: "
                "Invalid JSON: EOF while parsing a string"
            )
        return DraftTranslationOutput(
            translations=[
                DraftTranslationRow(
                    id="ignored",
                    text=f"translated {cue.identifier}",
                    confidence="high",
                    needs_attention=False,
                    difficulty_reason="",
                )
                for cue in batch
            ]
        )

    monkeypatch.setattr(translator, "_analyze_context", analyze)
    monkeypatch.setattr(translator, "_translate_batch", truncated_then_valid)

    result = await translator.translate_episode(cues, "Persian (Farsi)", "Korean")

    assert requested_sizes == [4, 2, 2]
    assert result.texts == tuple(f"translated {index}" for index in range(1, 5))
    assert "2 smaller targeted translation request(s)" in result.warnings[0]


@pytest.mark.asyncio
async def test_terminal_recovery_translates_small_remaining_groups_individually(
    monkeypatch,
) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=10_000,
    )
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text=f"source {index}",
        )
        for index in range(1, 25)
    ]
    requested_sizes = []

    async def incomplete_until_single(batch, *_args):
        requested_sizes.append(len(batch))
        returned = batch if len(batch) == 1 else batch[:-1]
        return DraftTranslationOutput(
            translations=[
                DraftTranslationRow(
                    id=cue.identifier,
                    text=f"translated {cue.identifier}",
                    confidence="high",
                    needs_attention=False,
                    difficulty_reason="",
                )
                for cue in returned
            ]
        )

    context = EpisodeContextOutput(
        summary="Context",
        overall_tone="neutral",
        register_and_formality="neutral",
        cultural_notes=[],
        characters=[],
        terminology=[],
        consistency_rules=[],
    )
    monkeypatch.setattr(translator, "_translate_batch", incomplete_until_single)

    rows, recovery_requests = await translator._translate_batch_with_id_recovery(
        cues,
        "Persian (Farsi)",
        "Korean",
        context,
        progress_callback=None,
        progress_fraction=0.5,
        completed_batches=0,
        total_batches=1,
    )

    assert [row.id for row in rows] == [str(index) for index in range(1, 25)]
    assert requested_sizes.count(1) == 24
    assert recovery_requests > 0


@pytest.mark.asyncio
async def test_translation_resumes_after_failure_without_repeating_saved_cues(
    monkeypatch, tmp_path
) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=45,
    )
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text=f"source {index}",
        )
        for index in range(1, 4)
    ]
    checkpoint_path = tmp_path / "episode.checkpoint.json"
    analyze_calls = 0
    requested_ids = []
    should_fail = True

    async def analyze(*_args):
        nonlocal analyze_calls
        analyze_calls += 1
        return EpisodeContextOutput(
            summary="Context",
            overall_tone="neutral",
            register_and_formality="neutral",
            cultural_notes=[],
            characters=[],
            terminology=[],
            consistency_rules=[],
        )

    async def fail_once_then_translate(batch, *_args):
        nonlocal should_fail
        requested_ids.append([cue.identifier for cue in batch])
        if batch[0].identifier == "2" and should_fail:
            should_fail = False
            raise TranslationError("AI draft translation request failed: connection lost")
        return DraftTranslationOutput(
            translations=[
                DraftTranslationRow(
                    id=cue.identifier,
                    text=f"translated {cue.identifier}",
                    confidence="high",
                    needs_attention=False,
                    difficulty_reason="",
                )
                for cue in batch
            ]
        )

    monkeypatch.setattr(translator, "_analyze_context", analyze)
    monkeypatch.setattr(translator, "_translate_batch", fail_once_then_translate)

    with pytest.raises(TranslationError, match="connection lost"):
        await translator.translate_episode(
            cues,
            "Persian (Farsi)",
            "Korean",
            checkpoint_path=checkpoint_path,
        )

    assert checkpoint_path.is_file()
    assert requested_ids == [["1"], ["2"]]

    result = await translator.translate_episode(
        cues,
        "Persian (Farsi)",
        "Korean",
        checkpoint_path=checkpoint_path,
    )

    assert analyze_calls == 1
    assert requested_ids == [["1"], ["2"], ["2"], ["3"]]
    assert result.texts == ("translated 1", "translated 2", "translated 3")
    assert "Resumed 1 previously translated cue(s)" in result.warnings[0]


@pytest.mark.asyncio
async def test_difficult_cue_request_uses_escalation_model(monkeypatch) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        review_model="gpt-5.6-terra",
        batch_character_limit=1000,
    )
    cue = SubtitleCue(
        identifier="1",
        timing="00:00:00,000 --> 00:00:01,000",
        text="ambiguous source",
    )
    difficult = DraftTranslationRow(
        id="1",
        text="draft",
        confidence="low",
        needs_attention=True,
        difficulty_reason="omitted subject",
    )
    context = EpisodeContextOutput(
        summary="A tense conversation.",
        overall_tone="tense",
        register_and_formality="formal",
        cultural_notes=[],
        characters=[],
        terminology=[],
        consistency_rules=[],
    )
    captured = {}

    async def request_structured(**kwargs):
        captured.update(kwargs)
        return RetryTranslationOutput(
            translations=[
                RetryTranslationRow(
                    id="1",
                    text="contextual translation",
                    confidence="medium",
                    interpretation="subject inferred",
                    resolution="Ambiguity preserved.",
                )
            ]
        )

    monkeypatch.setattr(translator, "_request_structured", request_structured)

    await translator._retry_difficult(
        [cue], [difficult], "Persian (Farsi)", "Korean", context
    )

    assert captured["model"] == "gpt-5.6-terra"


def test_cost_estimate_caps_targeted_review_and_uses_split_pricing() -> None:
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text="subtitle dialogue" * 10,
        )
        for index in range(1, 101)
    ]

    estimate = estimate_translation_cost(
        cues,
        model="gpt-5-mini",
        review_model="gpt-5.6-terra",
        batch_character_limit=8_000,
    )

    assert estimate.maximum_review_cues == 15
    assert estimate.maximum_request_count == estimate.batch_count + 2
    assert estimate.primary_model == "gpt-5-mini"
    assert estimate.review_model == "gpt-5.6-terra"
    assert estimate.estimated_review_input_tokens > 0
    assert estimate.estimated_review_output_tokens > 0
    assert estimate.estimated_cost_usd is not None
    assert estimate.estimated_cost_usd < 0.25


@pytest.mark.asyncio
async def test_context_analysis_retries_compact_after_invalid_json(monkeypatch) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=1000,
    )
    calls = []

    async def analyze(_cues, _target, _source, compact=False):
        calls.append(compact)
        if not compact:
            raise TranslationError(
                "AI episode context analysis request failed: validation error: Invalid JSON"
            )
        return EpisodeContextOutput(
            summary="Recovered context",
            overall_tone="neutral",
            register_and_formality="neutral",
            cultural_notes=[],
            characters=[],
            terminology=[],
            consistency_rules=[],
        )

    monkeypatch.setattr(translator, "_analyze_context", analyze)

    context, warning = await translator._analyze_context_with_recovery(
        [], "Persian (Farsi)", "Korean", None
    )

    assert calls == [False, True]
    assert context.summary == "Recovered context"
    assert warning == "Recovered malformed episode context with one compact retry."


@pytest.mark.asyncio
async def test_context_analysis_uses_safe_fallback_after_two_invalid_json_results(
    monkeypatch,
) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=1000,
    )

    async def invalid_context(*_args):
        raise TranslationError(
            "AI compact episode context recovery request failed: returned no structured result"
        )

    monkeypatch.setattr(translator, "_analyze_context", invalid_context)

    context, warning = await translator._analyze_context_with_recovery(
        [], "Persian (Farsi)", "Korean", None
    )

    assert context.characters == []
    assert "Do not invent" in context.consistency_rules[0]
    assert warning == "Episode context JSON failed twice; used a conservative fallback guide."


@pytest.mark.asyncio
async def test_translation_runs_independent_batches_with_bounded_concurrency(
    monkeypatch,
) -> None:
    translator = OpenAITranslator(
        api_key="sk-test-placeholder",
        model="gpt-5-mini",
        batch_character_limit=45,
        max_concurrent_requests=2,
    )
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text=f"source {index}",
        )
        for index in range(1, 5)
    ]
    active_requests = 0
    peak_requests = 0

    async def analyze(*_args):
        return EpisodeContextOutput(
            summary="Context",
            overall_tone="neutral",
            register_and_formality="neutral",
            cultural_notes=[],
            characters=[],
            terminology=[],
            consistency_rules=[],
        )

    async def translate_batch(batch, *_args):
        nonlocal active_requests, peak_requests
        active_requests += 1
        peak_requests = max(peak_requests, active_requests)
        await asyncio.sleep(0.01)
        active_requests -= 1
        return DraftTranslationOutput(
            translations=[
                DraftTranslationRow(
                    id=cue.identifier,
                    text=f"translated {cue.identifier}",
                    confidence="high",
                    needs_attention=False,
                    difficulty_reason="",
                )
                for cue in batch
            ]
        )

    monkeypatch.setattr(translator, "_analyze_context", analyze)
    monkeypatch.setattr(translator, "_translate_batch", translate_batch)

    result = await translator.translate_episode(cues, "Persian (Farsi)", "Korean")

    assert peak_requests == 2
    assert result.texts == tuple(f"translated {index}" for index in range(1, 5))


def test_context_sampling_limits_repeated_source_text() -> None:
    cues = [
        SubtitleCue(
            identifier=str(index),
            timing="00:00:00,000 --> 00:00:01,000",
            text="x" * 100,
        )
        for index in range(1, 101)
    ]

    sampled = sample_cues_for_context(cues, character_limit=1_200)

    assert len(sampled) < len(cues)
    assert sum(len(cue.text) for cue in sampled) <= 1_200
    assert sampled[0].identifier == "1"
    assert sampled[-1].identifier == "100"
