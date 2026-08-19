from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / "customer_portal"


def test_report_issue_explains_mistranslation_workflow() -> None:
    html = (PORTAL / "index.html").read_text(encoding="utf-8")

    assert "How to report a mistranslation" in html
    assert "Authorized subtitle" in html
    assert "Enter the approximate time" in html
    assert "show the subtitle lines around that moment" in html
    assert "Tap the line that looks mistranslated" in html
    assert "why the translation feels wrong" in html
    assert "helps us improve future translations" in html
