# Subtitle Project

Subtitle Project starts with a focused workflow: upload multiple raw SRT or timed CSV files,
translate their dialogue with AI, and download timing-safe results in one ZIP archive.

The server parses and renders subtitle structure locally. Only cue identifiers and dialogue
text are sent to the configured AI provider; timestamps are not generated or modified by AI.

## Project goal

Build a web and mobile subtitle application for viewers whose preferred language is not
available on streaming services such as Netflix or YouTube. The first delivery target is a
Windows workflow that translates user-provided subtitle files and displays them in a
transparent desktop overlay.

## Current implementation status

| Area | Status | What works now |
| --- | --- | --- |
| Web translator | Implemented | Upload multiple SRT/CSV files and download translated results in one ZIP |
| AI translation | Implemented | Batched OpenAI Responses API calls with cue-ID validation |
| Timed CSV | Implemented | Preserves `St`/`Et` and adds a target column such as `Subtitle_FA` |
| Fixed folders | Implemented | Translate every supported file from `input` into `output` |
| Windows overlay | Implemented | Transparent, always-on-top, click-through Persian subtitle display |
| Overlay synchronization | Manual MVP | Play, pause, seek, and offset controls use the overlay's own timer |
| Browser synchronization | Planned | Netflix/YouTube playback detection is not connected yet |
| iPad version | Deferred | Planned after the Windows workflow is complete |

The current application does not download, decrypt, transcribe, or extract streaming video.
Users supply subtitle files they own or have permission to process. The Windows overlay does
not yet detect playback state from Netflix or YouTube; synchronization is manual.

## MVP features

- Multiple `.srt` and `.csv` uploads with drag and drop
- Source-language auto-detection or an explicit source language
- Any user-specified target language, including Persian (Farsi)
- Batched OpenAI Responses API translation
- Strict cue-ID and response validation
- UTF-8 SRT output with original timing preserved
- CSV input with `St`, `Et`, and `Subtitle*` columns; translated text is added as a new column
- One ZIP download containing every result and a JSON processing summary
- File-count, file-size, extension, encoding, and SRT-structure validation
- Health endpoint, tests, Docker support, and GitHub Actions CI

## Local setup

Python 3.11 or newer is required.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

Set `OPENAI_API_KEY` in the current environment. The application never asks the browser for
the key and does not commit `.env` files.

```powershell
$env:OPENAI_API_KEY="your-api-key"
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000>. API documentation is available at
<http://127.0.0.1:8000/docs>.

OpenAI recommends the Responses API for new direct model requests. The default model can be
changed without code edits:

```powershell
$env:OPENAI_MODEL="gpt-5.6"
```

For a UI smoke test without calling an external API, use the deterministic echo provider:

```powershell
$env:TRANSLATION_PROVIDER="echo"
uvicorn app.main:app --reload
```

Echo mode prefixes cue text and must never be used as a real translation provider.

## Windows input/output folders

The repository includes a fixed local workflow:

```text
Subtitle project/
|-- input/       Put source .srt and timed .csv files here
|-- output/      Translated files and translation_summary.json appear here
|-- scripts/translate_folder.py
`-- dist/SubtitleOverlay.exe
```

Subtitle files inside `input` and generated files inside `output` are ignored by Git. To
translate every supported file currently in `input`, set the API key and run:

```powershell
$env:OPENAI_API_KEY="your-api-key"
.venv\Scripts\python.exe scripts\translate_folder.py
```

The default workflow translates Korean `Subtitle_KO` content to Persian (Farsi). Language,
source column, and folder locations can be overridden:

```powershell
.venv\Scripts\python.exe scripts\translate_folder.py `
  --source-language Korean `
  --target-language "Persian (Farsi)" `
  --source-column Subtitle_KO
```

Running the folder translator can incur OpenAI API charges. It does not run automatically
when files are copied into `input`; translation starts only when the command is executed.

## Tests

```powershell
ruff check .
pytest
```

The API integration tests override the translator with the deterministic provider, so they
do not require an API key or make network requests.

## Windows desktop overlay

`desktop/overlay.py` reads timed CSV files and displays the selected subtitle column in an
always-on-top, click-through window. It automatically prefers `Subtitle_FA` when available.

Build the standalone Windows executable with PyInstaller:

```powershell
pyinstaller --noconfirm --clean --onefile --windowed `
  --name SubtitleOverlay --distpath dist desktop/overlay.py
```

Double-click `dist/SubtitleOverlay.exe`, select a translated CSV, then use the controller to
play, pause, seek five seconds, or correct sync by half a second. This first version uses
manual synchronization and does not access or extract video playback data. The transparent,
click-through overlay previews the first subtitle for five seconds at launch; use **Show test
subtitle** in the controller to repeat that visibility check.
The file picker opens the project `output` folder by default.

## API

`POST /api/translations` accepts multipart form data:

- `files`: one or more SRT or timed CSV files
- `target_language`: required language name
- `source_language`: optional; omitted means auto-detect
- `source_column`: optional CSV text column; defaults to `Subtitle_KO`, then `Subtitle`

Successful requests return `application/zip`. Translation provider failures return `502`,
invalid files return `400` or `413`, and a missing server API key returns `503`.

## Data and copyright

Upload only subtitles you own or have permission to process. This MVP does not access,
download, decrypt, or modify video from Netflix, YouTube, or another streaming provider.
