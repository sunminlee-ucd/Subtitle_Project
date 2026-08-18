from __future__ import annotations

import httpx

from app.tmdb_catalog import TMDB_API_BASE, TmdbCatalog, _image_url, _provider_matches


class MockTmdbCatalog(TmdbCatalog):
    def __init__(self, handler) -> None:
        super().__init__("test-token", region="IE", language="en-IE")
        self._transport = httpx.MockTransport(handler)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=TMDB_API_BASE, transport=self._transport)


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/3/search/multi":
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "id": 1,
                        "media_type": "tv",
                        "name": "Derry Girls",
                        "original_name": "Derry Girls",
                        "first_air_date": "2018-01-04",
                        "poster_path": "/derry.jpg",
                        "overview": "Teenagers navigate life in Derry.",
                    },
                    {
                        "id": 2,
                        "media_type": "tv",
                        "name": "Andor",
                        "original_name": "Andor",
                        "first_air_date": "2022-09-21",
                        "poster_path": "/andor.jpg",
                        "overview": "A rebel story.",
                    },
                    {"id": 3, "media_type": "person", "name": "Someone"},
                ]
            },
        )
    if path == "/3/tv/1/watch/providers":
        return httpx.Response(
            200,
            json={"results": {"IE": {"flatrate": [{"provider_name": "Netflix"}]}}},
        )
    if path == "/3/tv/2/watch/providers":
        return httpx.Response(
            200,
            json={"results": {"IE": {"flatrate": [{"provider_name": "Disney Plus"}]}}},
        )
    if path == "/3/tv/1":
        return httpx.Response(
            200,
            json={
                "id": 1,
                "name": "Derry Girls",
                "poster_path": "/derry.jpg",
                "seasons": [
                    {
                        "season_number": 0,
                        "name": "Specials",
                        "episode_count": 1,
                        "poster_path": None,
                    },
                    {
                        "season_number": 1,
                        "name": "Season 1",
                        "episode_count": 6,
                        "air_date": "2018-01-04",
                        "poster_path": "/s1.jpg",
                    },
                ],
            },
        )
    if path == "/3/tv/1/season/1":
        return httpx.Response(
            200,
            json={
                "name": "Season 1",
                "poster_path": "/s1.jpg",
                "episodes": [
                    {
                        "episode_number": 1,
                        "name": "Episode One",
                        "air_date": "2018-01-04",
                        "overview": "The first episode.",
                        "still_path": "/e1.jpg",
                    },
                    {
                        "episode_number": 2,
                        "name": "Episode Two",
                        "air_date": "2018-01-11",
                        "overview": "The second episode.",
                        "still_path": None,
                    },
                ],
            },
        )
    return httpx.Response(404, json={"status_message": "Not found"})


async def test_search_filters_results_by_selected_streaming_provider() -> None:
    catalog = MockTmdbCatalog(_handler)

    netflix = await catalog.search("Derry", "netflix")
    disney = await catalog.search("Andor", "disney")

    assert [item["title"] for item in netflix] == ["Derry Girls"]
    assert netflix[0]["poster_url"] == "https://image.tmdb.org/t/p/w342/derry.jpg"
    assert netflix[0]["region"] == "IE"
    assert [item["title"] for item in disney] == ["Andor"]


async def test_tv_seasons_exclude_specials_and_keep_thumbnails() -> None:
    catalog = MockTmdbCatalog(_handler)

    result = await catalog.tv_seasons(1)

    assert result["title"] == "Derry Girls"
    assert len(result["seasons"]) == 1
    assert result["seasons"][0]["season_number"] == 1
    assert result["seasons"][0]["poster_url"] == "https://image.tmdb.org/t/p/w185/s1.jpg"


async def test_episode_results_include_still_thumbnails_when_available() -> None:
    catalog = MockTmdbCatalog(_handler)

    result = await catalog.season_episodes(1, 1)

    assert [episode["episode_number"] for episode in result["episodes"]] == [1, 2]
    assert result["episodes"][0]["still_url"] == "https://image.tmdb.org/t/p/w300/e1.jpg"
    assert result["episodes"][1]["still_url"] is None


def test_provider_aliases_cover_subscription_and_ad_tiers() -> None:
    assert _provider_matches("Netflix", "netflix")
    assert _provider_matches("Netflix basic with Ads", "netflix")
    assert _provider_matches("Disney Plus", "disney")
    assert not _provider_matches("Disney Plus", "netflix")


def test_image_url_rejects_invalid_paths() -> None:
    assert _image_url(None, "w342") is None
    assert _image_url("https://example.com/poster.jpg", "w342") is None
