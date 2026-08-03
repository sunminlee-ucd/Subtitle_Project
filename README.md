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
| AI translation | Implemented | Batched OpenAI Responses API calls aligned to timed cue order |
| Cost-optimized quality mode | Implemented | `gpt-5-mini` translates normally; only difficult cues escalate to `gpt-5.6-terra` |
| Live progress | Implemented | GUI and CLI show episode, stage, batch count, and overall percentage |
| Timed CSV | Implemented | Preserves `St`/`Et` and adds a target column such as `Subtitle_FA` |
| Episode splitter | Implemented | Detects timeline resets, keeps partial final captures, and creates one SRT per episode |
| Desktop translator | Implemented | Choose the CSV, starting episode, source/target language, and output folder |
| Fixed folders | Implemented | Translate every supported file from `input` into `output` |
| Windows overlay | Implemented | Opens SRT/CSV in a transparent, always-on-top, click-through display |
| Overlay synchronization | Manual MVP | Play, pause, seek, and offset controls use the overlay's own timer |
| Browser synchronization | Implemented MVP | Chrome extension loads local SRT and follows Netflix/YouTube playback |
| iPad version | Deferred | Planned after the Windows workflow is complete |

The current application does not download, decrypt, transcribe, or extract streaming video.
Users supply subtitle files they own or have permission to process. The Windows overlay does
not yet detect playback state from Netflix or YouTube; synchronization is manual.

## MVP features

- Multiple `.srt` and `.csv` uploads with drag and drop
- Source-language auto-detection or an explicit source language
- Any user-specified target language, including Persian (Farsi)
- Batched OpenAI Responses API translation
- Timed-order alignment, response-count validation, and truncated-JSON recovery
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
$env:OPENAI_MODEL="gpt-5-mini"
$env:OPENAI_REVIEW_MODEL="gpt-5.6-terra"
```

The primary model handles episode context and every first-pass translation. The escalation
model receives only cues marked uncertain or detected as risky, capped at 15% of an episode.
If no cue is difficult, no escalation request is made. Before translation, the Windows app
estimates the two models' costs separately and blocks work above the configured USD guard.
Human correction is deferred; unresolved cases remain visible in each `.quality.json` report.

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

## Combined capture CSV to episode SRT files

`desktop/subtitle_processor.py` processes capture files with `St`, `Et`, and `Subtitle`
columns. A backward timestamp jump of ten minutes or more starts a new episode. The starting
episode number is selected by the user, so a capture beginning with episode 3 produces
`*.ep03.*.srt`, `*.ep04.*.srt`, and so on. There is no fixed episode limit.

The processor removes the capture-only `Save Phrase` suffix and the initial "subtitle has
not started" placeholder before translation. Every detected segment is kept. Because the end
of the input may be a cut-off capture, the final segment is marked `unknown_end_of_input` in
`episode_translation_summary.json` and is not translated by default. The desktop checkbox or
CLI `--include-incomplete-final` option can override this only when the user knows it is complete.

### Context-aware quality translation

Every complete episode uses a multi-stage translation workflow:

1. Analyze the episode summary, emotional tone, formality, character speech styles,
   relationships, names, and recurring terminology.
2. Translate each batch using that episode-wide consistency guide.
3. Detect ambiguous or culturally difficult cues, including idioms, omitted subjects,
   honorifics, sarcasm, wordplay, and unclear pronouns.
4. Re-translate difficult cues with the episode context. Genuine ambiguity is preserved instead
   of inventing missing facts.
5. Run a focused second pass only for the highest-risk cues instead of retranslating the episode.

The desktop progress bar updates after every context, translation, difficult-cue, and review API
stage. The log includes the current episode, stage, batch count, and overall percentage.

The Windows processor writes an atomic checkpoint after context analysis and after every
successful translation group. If a request, connection, or application fails, run the same input
again with the same source/target languages and models. Completed cues are loaded from
`output/episodes/.translation_checkpoints` and only unfinished cues are sent to the API. A changed
source file, language, or model automatically gets a different fingerprint and will not reuse
incompatible translations.

Each translated SRT has a matching `*.quality.json` report. It contains the episode guide,
warnings, and difficult or corrected cues with the source text, applied final translation,
confidence, problem, action taken, and resolution. Cues that remain uncertain are retained in the
SRT using the safest contextual translation and explicitly flagged for human review.

### Cost controls

The desktop processor defaults to `gpt-5-mini`, a low-cost model suitable for well-defined,
high-volume work. Before loading the private key or starting translation, the GUI displays a
conservative estimate of input/output tokens, maximum API requests, maximum reviewed cues, and
standard-rate USD cost. The default `$0.25` guard blocks a run whose estimate exceeds that value.

To keep quality high without paying for a complete second translation:

- Episode context is compact and sampled only when a capture is unusually large.
- Each subtitle is translated once with structured confidence and difficulty fields.
- Local checks also detect unchanged and abnormally long translations without an API call.
- Only the highest-risk 15% of cues can be sent for targeted re-translation and final review.
- Additional uncertain cues remain visible in the quality report for human review.
- Repeated episode context uses a stable prompt-cache key, GPT-5 models use low reasoning effort,
  and response token limits prevent unexpectedly long outputs.
- AI results are aligned to cues by input position, which is already chronological. Returned ID
  values are ignored and reassigned locally. Only a missing or extra translation item triggers
  smaller retries for the affected batch, capped at three split levels to limit recovery charges.
- Successful recovery subgroups are checkpointed immediately, so a later failure does not charge
  again for those completed cues on the next run.

The estimate is not a billing guarantee, because tokenizer behavior, reasoning tokens, model
pricing, and account incentives can change. Set a platform-level monthly budget as the final hard
spend limit.

Analyze a file without using the API or incurring charges:

```powershell
.venv\Scripts\python.exe scripts\split_translate_to_srt.py `
  "C:\path\to\captured_subs.csv" `
  --start-episode 3 `
  --analyze-only
```

Translate it to Persian SRT files:

```powershell
$env:OPENAI_API_KEY="your-api-key"
.venv\Scripts\python.exe scripts\split_translate_to_srt.py `
  "C:\path\to\captured_subs.csv" `
  --start-episode 3 `
  --target-language "Persian (Farsi)"
```

For the Windows interface, build and open `SubtitleProcessor.exe`:

```powershell
pyinstaller --noconfirm --clean --onefile --windowed `
  --name SubtitleProcessor --distpath dist desktop/subtitle_processor.py
```

The **Analyze episodes** button is local and free. The translation button asks for explicit
confirmation before sending subtitle text to OpenAI; an API key with available paid credit is
required.

For the local Windows build, `API key for openAI.txt` in the project root is loaded only when
translation starts. It may contain either a raw `sk-...` key or an
`OPENAI_API_KEY="sk-..."` line. The file is ignored by Git and is never bundled into the EXE.

## Tests

```powershell
ruff check .
pytest
```

The API integration tests override the translator with the deterministic provider, so they
do not require an API key or make network requests.

## Windows desktop overlay

`desktop/overlay.py` reads SRT or timed CSV files and displays the subtitle text in an
always-on-top, click-through window. For CSV it automatically prefers `Subtitle_FA` when
available. SRT files produced by the episode processor can be opened directly.

Build the standalone Windows executable with PyInstaller:

```powershell
pyinstaller --noconfirm --clean --onefile --windowed `
  --name SubtitleOverlay --distpath dist desktop/overlay.py
```

Double-click `dist/SubtitleOverlay.exe`, select a translated SRT or CSV, then use the controller to
play, pause, seek five seconds, or correct sync by half a second. This first version uses
manual synchronization and does not access or extract video playback data. The transparent,
click-through overlay previews the first subtitle for five seconds at launch; use **Show test
subtitle** in the controller to repeat that visibility check.
The file picker opens the project `output` folder by default.

## Chrome SRT playback synchronization

`chrome_extension` contains an unpacked Manifest V3 extension that detects the largest visible
Netflix or YouTube `<video>` element, loads a user-selected local SRT file, and renders the
matching cue from the video's current time. Play, pause, seeking, playback-rate changes, and
fullscreen transitions are followed automatically. The extension does not capture or transmit
video, audio, or the selected subtitle file.

The same popup captures subtitles already rendered by Netflix into `St,Et,Subtitle` CSV or SRT.
Netflix native captions are preferred; Language Reactor is only a fallback. Captures remain local
to the active tab and can run at 1x, 1.5x, 2x, or 3x playback speed. A persistent Downloads
subfolder can be configured once for automatic CSV/SRT export without repeated prompts.

The extension also includes an experimental direct subtitle-track probe. It watches for TTML,
WebVTT, XML, or subtitle-shaped JSON responses that the signed-in Netflix player normally receives
when a native subtitle language is selected. This can validate whether a complete timed-text track
is available for direct SRT conversion without playing the full episode. The probe removes URL
query strings and never stores cookies, authorization headers, video, audio, or DRM data. See
`chrome_extension/README.md` for the test procedure.

`SubtitleProcessor.exe` accepts the downloaded Netflix `.ttml` or `.xml` directly. It parses
Netflix tick-based timestamps and `<br/>` line breaks, saves a UTF-8 source CSV, treats the full
track as a completed episode, then writes a translated CSV, Persian SRT, quality report, and run
summary. The SRT can be loaded back into the same extension for playback-synchronized testing.
Multiple XML/TTML files can be selected in one run; every file remains separate and creates its
own output set. Episode markers such as `E4` in the Netflix-derived filename are preserved as the
episode number in the generated CSV/SRT names.

To install it locally without publishing:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the repository's `chrome_extension` folder.
4. Open or reload a Netflix or YouTube watch page.
5. Open **Netflix SRT Subtitle Sync** from the Chrome toolbar and choose an SRT file.

The popup includes timing offset, font-size, and height controls. Positive offset delays the
subtitles and negative offset displays them earlier. The subtitle renderer and diagnostic panel
remain inside the fullscreen player. The diagnostic panel is hidden by default and can be enabled
from the popup for troubleshooting. Reloading the page clears the selected SRT, so choose it again
after a reload.

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
