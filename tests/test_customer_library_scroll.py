from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "customer_extension"


def test_customer_library_has_bounded_internal_scroll_area() -> None:
    css = (EXTENSION / "overlay-toggle.css").read_text(encoding="utf-8")

    assert "#libraryCard .track-list" in css
    assert "height:190px" in css
    assert "max-height:190px" in css
    assert "overflow-y:scroll" in css
    assert "overflow-x:hidden" in css
    assert "overscroll-behavior:contain" in css
    assert "scrollbar-gutter:stable" in css


def test_customer_library_scrollbar_is_visually_distinct() -> None:
    css = (EXTENSION / "overlay-toggle.css").read_text(encoding="utf-8")

    assert "#libraryCard .track-list::-webkit-scrollbar" in css
    assert "#libraryCard .track-list::-webkit-scrollbar-thumb" in css
    assert "background:#5a2a2f" in css


def test_customer_extension_version_includes_scroll_change() -> None:
    manifest = (EXTENSION / "manifest.json").read_text(encoding="utf-8")

    assert '"version": "0.3.4"' in manifest
