# TMDB catalogue configuration

Subtitle Companion keeps the TMDB credential on the FastAPI server. The customer browser only calls `/api/catalog/*` routes and never receives the TMDB API token.

## Required server setting

Create a TMDB account and API Read Access Token, then configure Cloud Run with:

```text
TMDB_API_TOKEN=<TMDB API Read Access Token>
TMDB_REGION=IE
TMDB_LANGUAGE=en-IE
```

`TMDB_REGION` defaults to `IE` and `TMDB_LANGUAGE` defaults to `en-IE`, so only the token is required for the current Ireland deployment.

For production, store the token in Google Secret Manager and map it to the `TMDB_API_TOKEN` environment variable on the `subtitle-project` Cloud Run service. Do not put the token in `customer_portal/config.js`, source control, or browser JavaScript.

## Customer flow

For Netflix and Disney+ requests:

1. Search TMDB for a movie or TV series.
2. Filter results against TMDB/JustWatch watch-provider data for Ireland and the selected service.
3. Show poster thumbnails in title results.
4. For TV series, load regular seasons and exclude season 0/specials.
5. Load episode metadata and still thumbnails for the selected season.
6. Save the TMDB ID, media type, year, season, episode, and episode title with the existing request record.

YouTube and Other requests continue to use manual title entry. Manual entry also remains available as a fallback if a title cannot be found in TMDB or watch-provider data.

## Attribution

The customer portal includes TMDB attribution and the required TMDB non-endorsement notice. Because watch-provider availability is powered by JustWatch, the portal also credits JustWatch next to the TMDB notice.
