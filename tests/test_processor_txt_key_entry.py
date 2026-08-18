from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_txt_key_processor_forces_private_key_file_path() -> None:
    source = (ROOT / "desktop" / "subtitle_processor_txt_key.py").read_text(encoding="utf-8")

    assert 'os.environ.pop("OPENAI_API_KEY", None)' in source
    assert 'self.api_key.set("")' in source
    assert "super().translate()" in source
    assert "API key source" in source
    assert "API_KEY_SOURCE_LABEL" in source


def test_processor_build_script_uses_txt_key_entry_point() -> None:
    source = (ROOT / "scripts" / "build_processor.ps1").read_text(encoding="utf-8")

    assert "desktop/subtitle_processor_txt_key.py" in source
    assert "--name SubtitleProcessor" in source
