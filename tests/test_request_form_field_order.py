from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_request_form_starts_with_service_and_title_then_language() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")

    provider = html.index('id="requestProvider"')
    title = html.index('id="requestTitle"')
    language = html.index('id="requestLanguage"')
    season = html.index('id="requestSeason"')

    assert provider < title < language < season
    assert 'class="grid request-primary-grid"' in html
    assert 'class="request-language-row"' in html


def test_required_and_optional_fields_are_explicitly_badged() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert 'Streaming service <span class="field-badge required">Required</span>' in html
    assert 'Title <span class="field-badge required">Required</span>' in html
    assert 'Subtitle language <span class="field-badge required">Required</span>' in html
    assert 'Season <span class="field-badge optional">Optional</span>' in html
    assert 'Episode <span class="field-badge optional">Optional</span>' in html
    assert 'Streaming link <span class="field-badge optional">Optional</span>' in html
    assert 'Notes <span class="field-badge optional">Optional</span>' in html
    assert '<select id="requestProvider" required>' in html
    assert '<input id="requestTitle" required' in html
    assert '<input id="requestLanguage" required' in html


def test_request_badges_are_visually_distinct_and_mobile_order_stacks() -> None:
    styles = (PORTAL / "request-form.css").read_text(encoding="utf-8")
    html = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert ".field-badge.required" in styles
    assert ".field-badge.optional" in styles
    assert "background:rgba(220,38,38,.20)" in styles
    assert "@media (max-width:760px)" in styles
    assert ".request-primary-grid {\n    grid-template-columns:1fr;" in styles
    assert "/portal-assets/request-form.css" in html
