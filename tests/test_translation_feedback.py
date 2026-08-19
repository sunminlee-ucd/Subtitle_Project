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


def test_translation_fields_only_become_required_for_translation_reports() -> None:
    source = (PORTAL / "translation-feedback.js").read_text(encoding="utf-8")

    assert 'const isTranslation = $("reportCategory")?.value === "translation"' in source
    assert '$("translationCurrentText").required = isTranslation' in source
    assert "track.required = isTranslation" in source
    assert "time.required = isTranslation" in source
    assert "message.required = !isTranslation" in source


def test_admin_can_curate_and_export_approved_feedback_without_customer_identity() -> None:
    source = (PORTAL / "admin-translation-feedback.js").read_text(encoding="utf-8")

    assert "Approve for dataset" in source
    assert "Return to review" in source
    assert 'dataset_status: status' in source
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
