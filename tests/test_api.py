import io
import json
import zipfile

from fastapi.testclient import TestClient

from app.main import app, get_translator
from app.translator import EchoTranslator

client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_translate_multiple_files_to_zip() -> None:
    app.dependency_overrides[get_translator] = lambda: EchoTranslator()
    sample = b"1\n00:00:01,000 --> 00:00:03,000\nHello\n"
    try:
        response = client.post(
            "/api/translations",
            data={"target_language": "Persian (Farsi)"},
            files=[
                ("files", ("episode-1.srt", sample, "application/x-subrip")),
                ("files", ("episode-2.srt", sample, "application/x-subrip")),
            ],
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert "episode-1.persian-farsi.srt" in names
        translated = archive.read("episode-1.persian-farsi.srt").decode("utf-8-sig")
        assert "[Persian (Farsi)] Hello" in translated
        summary = json.loads(archive.read("translation_summary.json"))
        assert len(summary["files"]) == 2


def test_rejects_non_srt_file() -> None:
    app.dependency_overrides[get_translator] = lambda: EchoTranslator()
    try:
        response = client.post(
            "/api/translations",
            data={"target_language": "Korean"},
            files={"files": ("notes.txt", b"hello", "text/plain")},
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 400


def test_translate_csv_adds_target_language_column() -> None:
    app.dependency_overrides[get_translator] = lambda: EchoTranslator()
    sample = (
        'St,Et,Subtitle,Subtitle_KO\r\n"00:00:01,000","00:00:03,000",Hello,안녕하세요\r\n'
    ).encode()
    try:
        response = client.post(
            "/api/translations",
            data={"target_language": "Persian (Farsi)"},
            files={"files": ("episode.csv", sample, "text/csv")},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        translated = archive.read("episode.persian-farsi.csv").decode("utf-8-sig")
        assert "Subtitle_FA" in translated
        assert "[Persian (Farsi)] 안녕하세요" in translated
