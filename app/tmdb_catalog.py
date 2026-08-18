from __future__ import annotations

import asyncio
from typing import Any, Literal

import httpx

CatalogProvider = Literal["netflix", "disney"]

TMDB_API_BASE = "https://api.themoviedb.org/3"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"


class TmdbCatalogError(RuntimeError):
    """Raised when the TMDB catalog cannot be queried safely."""


class TmdbCatalog:
    def __init__(
        self,
        api_token: str,
        *,
        region: str = "IE",
        language: str = "en-IE",
        timeout_seconds: float = 8.0,
    ) -> None:
        self._api_token = api_token.strip()
        self._region = region.strip().upper() or "IE"
        self._language = language.strip() or "en-IE"
        self._timeout = timeout_seconds

    async def search(self, query: str, provider: CatalogProvider) -> list[dict[str, Any]]:
        normalized_query = " ".join(query.strip().split())
        if len(normalized_query) < 2:
            return []

        async with self._client() as client:
            payload = await self._get_json(
                client,
                "/search/multi",
                params={
                    "query": normalized_query,
                    "include_adult": "false",
                    "language": self._language,
                    "page": 1,
                },
            )
            candidates = [
                row
                for row in payload.get("results", [])
                if row.get("media_type") in {"movie", "tv"} and not row.get("adult", False)
            ][:12]
            availability = await asyncio.gather(
                *(
                    self._available_on(
                        client,
                        str(row["media_type"]),
                        int(row["id"]),
                        provider,
                    )
                    for row in candidates
                ),
                return_exceptions=True,
            )

        results: list[dict[str, Any]] = []
        for row, available in zip(candidates, availability, strict=True):
            if available is not True:
                continue
            media_type = str(row["media_type"])
            title_value = row.get("name") if media_type == "tv" else row.get("title")
            title = str(title_value or "").strip()
            if not title:
                continue
            date_raw = (
                row.get("first_air_date") if media_type == "tv" else row.get("release_date")
            )
            date_value = str(date_raw or "")
            original_title_raw = (
                row.get("original_name") if media_type == "tv" else row.get("original_title")
            )
            results.append(
                {
                    "id": int(row["id"]),
                    "media_type": media_type,
                    "title": title,
                    "original_title": str(original_title_raw or "").strip(),
                    "year": date_value[:4] if len(date_value) >= 4 else "",
                    "overview": str(row.get("overview") or "").strip(),
                    "poster_url": _image_url(row.get("poster_path"), "w342"),
                    "provider": provider,
                    "region": self._region,
                }
            )
            if len(results) >= 8:
                break
        return results

    async def tv_seasons(self, series_id: int) -> dict[str, Any]:
        async with self._client() as client:
            payload = await self._get_json(
                client,
                f"/tv/{series_id}",
                params={"language": self._language},
            )

        seasons = []
        for season in payload.get("seasons", []):
            season_number = int(season.get("season_number", -1))
            if season_number <= 0:
                continue
            seasons.append(
                {
                    "season_number": season_number,
                    "name": str(season.get("name") or f"Season {season_number}"),
                    "episode_count": int(season.get("episode_count") or 0),
                    "air_date": str(season.get("air_date") or ""),
                    "poster_url": _image_url(season.get("poster_path"), "w185"),
                }
            )
        return {
            "id": int(payload.get("id") or series_id),
            "title": str(payload.get("name") or ""),
            "poster_url": _image_url(payload.get("poster_path"), "w342"),
            "seasons": seasons,
        }

    async def season_episodes(self, series_id: int, season_number: int) -> dict[str, Any]:
        async with self._client() as client:
            payload = await self._get_json(
                client,
                f"/tv/{series_id}/season/{season_number}",
                params={"language": self._language},
            )

        episodes = []
        for episode in payload.get("episodes", []):
            episode_number = int(episode.get("episode_number", -1))
            if episode_number <= 0:
                continue
            episodes.append(
                {
                    "episode_number": episode_number,
                    "name": str(episode.get("name") or f"Episode {episode_number}"),
                    "air_date": str(episode.get("air_date") or ""),
                    "overview": str(episode.get("overview") or "").strip(),
                    "still_url": _image_url(episode.get("still_path"), "w300"),
                }
            )
        return {
            "series_id": series_id,
            "season_number": season_number,
            "name": str(payload.get("name") or f"Season {season_number}"),
            "poster_url": _image_url(payload.get("poster_path"), "w185"),
            "episodes": episodes,
        }

    async def _available_on(
        self,
        client: httpx.AsyncClient,
        media_type: str,
        media_id: int,
        provider: CatalogProvider,
    ) -> bool:
        payload = await self._get_json(client, f"/{media_type}/{media_id}/watch/providers")
        region = payload.get("results", {}).get(self._region, {})
        provider_rows = [
            *region.get("flatrate", []),
            *region.get("ads", []),
        ]
        return any(
            _provider_matches(str(row.get("provider_name") or ""), provider)
            for row in provider_rows
        )

    async def _get_json(
        self,
        client: httpx.AsyncClient,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = await client.get(path, params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            raise TmdbCatalogError(f"TMDB returned HTTP {status}.") from exc
        except httpx.HTTPError as exc:
            raise TmdbCatalogError("TMDB could not be reached.") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise TmdbCatalogError("TMDB returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise TmdbCatalogError("TMDB returned an unexpected response.")
        return payload

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=TMDB_API_BASE,
            timeout=self._timeout,
            headers={
                "Authorization": f"Bearer {self._api_token}",
                "Accept": "application/json",
                "User-Agent": "SubtitleCompanion/0.1",
            },
        )


def _provider_matches(provider_name: str, provider: CatalogProvider) -> bool:
    normalized = "".join(character for character in provider_name.casefold() if character.isalnum())
    if provider == "netflix":
        return normalized.startswith("netflix")
    return normalized.startswith("disneyplus")


def _image_url(path: Any, size: str) -> str | None:
    if not isinstance(path, str) or not path.startswith("/"):
        return None
    return f"{TMDB_IMAGE_BASE}/{size}{path}"
