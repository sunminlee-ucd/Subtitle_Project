import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"
MIGRATION = ROOT / "supabase" / "migrations" / "20260819_structured_translation_feedback.sql"


def test_translation_feedback_migration_is_structured_and_rls_protected() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "create table if not exists public.translation_feedback" in sql
    assert "issue_reason text not null" in sql
    assert "current_text text not null" in sql
    assert "suggested_text text not null default ''" in sql
    assert "dataset_status text not null default 'unreviewed'" in sql
    assert "alter table public.translation_feedback enable row level security" in sql
    assert "private.can_access_subtitle(subtitle_track_id)" in sql
    assert "private.is_subtitle_admin()" in sql
    assert "submit_translation_feedback" in sql


def test_customer_translation_report_uses_timestamp_cue_picker_instead_of_copying_text() -> None:
    source = (PORTAL / "translation-feedback.js").read_text(encoding="utf-8")

    assert 'id="translationTime"' in source
    assert 'id="showNearbyCues"' in source
    assert 'id="translationCueList"' in source
    assert 'id="translationCurrentText" type="hidden"' in source
    assert "You do not need to copy any subtitle text" in source
    assert "Copy the subtitle line that looks wrong" not in source
    assert "function selectCue(cue, button)" in source
    assert '$("translationCurrentText").value = cue.text' in source
    assert 'p_cue_time_seconds: selectedCue.start' in source
    assert 'p_current_text: selectedCue.text' in source


def test_cue_picker_reads_private_srt_storage_first_and_keeps_legacy_fallback() -> None:
    source = (PORTAL / "translation-feedback.js").read_text(encoding="utf-8")

    assert "select=id,storage_path" in source
    assert "/storage/v1/object/authenticated/subtitle-files/" in source
    assert "parseSrt(srt)" in source
    assert "select=id,cues" in source
    assert "normalizeLegacyCues" in source
    assert "const cueCache = new Map()" in source
    assert "localStorage" not in source


def test_cue_picker_accepts_human_friendly_times_and_shows_nearby_lines() -> None:
    source = (PORTAL / "translation-feedback.js").read_text(encoding="utf-8")

    assert "12:34 or 1:12:34" in source
    assert "function parseUserTime(raw)" in source
    assert "parts.length === 2 || parts.length === 3" in source
    assert "function nearbyCues(cues, targetSeconds, count)" in source
    assert "nearbyCues(cues, targetSeconds, 7)" in source
    assert "function formatClock(seconds)" in source


def test_translation_fields_only_require_track_and_selected_cue() -> None:
    source = (PORTAL / "translation-feedback.js").read_text(encoding="utf-8")

    assert 'const isTranslation = $("reportCategory")?.value === "translation"' in source
    assert "track.required = isTranslation" in source
    assert "time.required = false" in source
    assert "message.required = !isTranslation" in source
    assert "url.required = !isTranslation" in source
    assert "if (!selectedCue" in source
    assert "show nearby subtitles, and choose the incorrect line" in source


def test_customer_translation_report_collects_training_quality_fields() -> None:
    source = (PORTAL / "translation-feedback.js").read_text(encoding="utf-8")

    assert "translationIssueReason" in source
    assert "translationCurrentText" in source
    assert "translationSuggestedText" in source
    assert "Wrong meaning" in source
    assert "Context misunderstood" in source
    assert "Name / terminology" in source
    assert 'client.rpc("submit_translation_feedback"' in source
    assert 'p_source_surface: "web"' in source
    assert 'form.addEventListener("submit", submitTranslationFeedback, true)' in source


def test_admin_can_curate_and_export_approved_feedback_without_customer_identity() -> None:
    source = (PORTAL / "admin-translation-feedback.js").read_text(encoding="utf-8")

    assert "Approve for dataset" in source
    assert "Return to review" in source
    assert "dataset_status: status" in source
    assert "Export approved CSV" in source
    assert '"current_translation"' in source
    assert '"suggested_translation"' in source
    assert 'link.download = `translation-feedback-approved-' in source

    export_header = source.split("const header = [", 1)[1].split("];", 1)[0]
    assert "customer_id" not in export_header
    assert "email" not in export_header


def test_portal_client_loads_customer_and_admin_feedback_extensions() -> None:
    source = (PORTAL / "supabase-client.js").read_text(encoding="utf-8")

    assert '"/portal-assets/translation-feedback.js?v=20260819-1"' in source
    assert '"/portal-assets/admin-translation-feedback.js?v=20260819-1"' in source
    assert "script.async = false" in source


@pytest.mark.parametrize(
    "filename",
    ["supabase-client.js", "translation-feedback.js", "admin-translation-feedback.js"],
)
def test_translation_feedback_javascript_is_valid(filename: str) -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is not available on PATH")

    subprocess.run(
        [node, "--check", str(PORTAL / filename)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
