from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_subtitle_language_has_click_help_control() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert 'id="languageHelpButton"' in html
    assert 'aria-controls="languageHelpText"' in html
    assert 'aria-expanded="false"' in html
    assert 'id="languageHelpText"' in html
    assert "Enter the language you want the subtitles to be in" in html


def test_language_help_auto_hides_after_three_seconds() -> None:
    script = (PORTAL / "customer.js").read_text(encoding="utf-8")

    assert '$("languageHelpButton").addEventListener("click", showLanguageHelp)' in script
    assert "function showLanguageHelp()" in script
    assert "languageHelpTimer = setTimeout" in script
    assert "}, 3000);" in script
    assert 'button.setAttribute("aria-expanded", "true")' in script
    assert 'button.setAttribute("aria-expanded", "false")' in script


def test_language_help_is_compact_on_mobile() -> None:
    styles = (PORTAL / "request-form.css").read_text(encoding="utf-8")

    assert ".field-help-button" in styles
    assert ".language-help-text" in styles
    assert "@media (max-width:760px)" in styles
