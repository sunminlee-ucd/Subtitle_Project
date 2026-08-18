import io
import json
import zipfile

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app, get_tmdb_catalog, get_translator
from app.translator import EchoTranslator

client = TestClient(app)


class FakeCatalog:
    async def search(self, query: str, provider: str) -> list[dict[str, object]]:
        return [
            {
                "id": 42,
                "media_type": "tv",
                "title": "Derry Girls",
                "year": "2018",
                "poster_url": "https://image.tmdb.org/t/p/w342/poster.jpg",
                "provider": provider,
                "region": "IE",
                "query": query,
            }
        ]

    async def tv_seasons(self, series_id: int) -> dict[str, object]:
        return {
            "id": series_id,
            "title": "Derry Girls",
            "seasons": [{"season_number": 1, "name": "Season 1", "episode_count": 6}],
        }

    async def season_episodes(self, series_id: int, season_number: int) -> dict[str, object]:
        return {
            "series_id": series_id,
            "season_number": season_number,
            "episodes": [{"episode_number": 1, "name": "Episode One", "still_url": None}],
        }


def test_default_translation_model_prioritizes_context_quality(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_REVIEW_MODEL", raising=False)

    settings = Settings.from_environment()

    assert settings.openai_model == "gpt-5.6-terra"
    assert settings.openai_review_model == "gpt-5.6-terra"


def test_health_endpoint() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "catalog_ready" in response.json()
    assert response.json()["catalog_region"] == "IE"


def test_root_redirects_to_customer_request_view() -> None:
    response = client.get("/", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == "/customer?view=request"


def test_catalog_search_route_uses_server_side_catalog() -> None:
    app.dependency_overrides[get_tmdb_catalog] = lambda: FakeCatalog()
    try:
        response = client.get("/api/catalog/search", params={"q": "Derry", "provider": "netflix"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["title"] == "Derry Girls"
    assert result["provider"] == "netflix"
    assert result["query"] == "Derry"


def test_catalog_tv_routes_return_seasons_and_episodes() -> None:
    app.dependency_overrides[get_tmdb_catalog] = lambda: FakeCatalog()
    try:
        seasons = client.get("/api/catalog/tv/42")
        episodes = client.get("/api/catalog/tv/42/season/1")
    finally:
        app.dependency_overrides.clear()

    assert seasons.status_code == 200
    assert seasons.json()["seasons"][0]["season_number"] == 1
    assert episodes.status_code == 200
    assert episodes.json()["episodes"][0]["episode_number"] == 1


def test_catalog_search_rejects_unsupported_provider() -> None:
    app.dependency_overrides[get_tmdb_catalog] = lambda: FakeCatalog()
    try:
        response = client.get("/api/catalog/search", params={"q": "Derry", "provider": "other"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


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
