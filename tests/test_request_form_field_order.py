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


def test_redundant_required_optional_legend_is_removed() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")
    styles = (PORTAL / "request-form.css").read_text(encoding="utf-8")

    assert "fields must be completed" not in html
    assert "fields can be left blank" not in html
    assert "request-field-order-note" not in html
    assert ".request-field-order-note" not in styles


def test_request_badges_are_visually_distinct_and_mobile_order_stacks() -> None:
    styles = (PORTAL / "request-form.css").read_text(encoding="utf-8")
    html = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert ".field-badge.required" in styles
    assert ".field-badge.optional" in styles
    assert "background:rgba(220,38,38,.20)" in styles
    assert "@media (max-width:760px)" in styles
    assert ".request-primary-grid {\n    grid-template-columns:1fr;" in styles
    assert "/portal-assets/request-form.css?v=20260819-3" in html


def test_mobile_request_form_is_compact_without_ios_input_zoom() -> None:
    styles = (PORTAL / "request-form.css").read_text(encoding="utf-8")

    assert ".request-card .compact-heading p {\n    display:none;" in styles
    assert ".request-card input," in styles
    assert "font-size:16px" in styles
    assert ".request-card .compact-grid" in styles
    assert "grid-template-columns:repeat(2,minmax(0,1fr))" in styles
    assert ".request-card textarea" in styles
    assert "min-height:50px" in styles
    assert ".request-card .submit-row .primary-action" in styles
    assert "width:100%" in styles
