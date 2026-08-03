# Netflix SRT Subtitle Sync

This unpacked Manifest V3 extension captures rendered Netflix subtitles and loads a local SRT
file for synchronized display. It follows the largest visible video's current time, pause, seek,
playback rate, and fullscreen state.

The SRT file remains inside the active browser tab. The extension does not read, download,
record, decrypt, or transmit video or audio.

## Install without publishing

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this `chrome_extension` directory.
4. After a code update, click the extension card's reload button and reload Netflix.

## Test direct Netflix subtitle-track detection

This test listens only for timed-text responses that the signed-in Netflix player normally
receives after you select one of Netflix's own subtitle languages. It does not bypass account,
region, title, or DRM restrictions.

1. Reload this extension on `chrome://extensions`, then reload the Netflix watch page once.
2. The document-start probe listens automatically and retains early subtitle responses locally.
   You do not need to switch the selected subtitle off and on.
3. Open the extension. A detected candidate shows its format, estimated cue count, size, and
   whether it arrived through Fetch or XHR.
4. Select a candidate and choose **Download selected raw track**. If the popup was opened late,
   **Recover cached response** asks the page probe to resend its retained candidates.

A complete TTML or WebVTT candidate with many cues can be converted to SRT without playing the
whole episode. The downloaded diagnostic file contains the response body and a sanitized source
path only. URL query strings, cookies, authorization data, video, and audio are not stored.
The download filename is derived from Netflix's visible title/episode control, the document title,
and the timed-text language. If Netflix does not expose an episode label, the title and watch ID
are used as safe fallbacks.
The title observer also recognizes one-line labels such as `Teach You a Lesson E4 Episode 4` and
remembers them after the player overlay disappears. Candidates are consolidated by Netflix watch
ID, so only the response with the largest cue count remains for each video.

Open a downloaded `.ttml` or `.xml` file in `dist/SubtitleProcessor.exe`. The processor saves a
UTF-8 `*.source.csv`, translates the complete track, and writes both a translated CSV and final
SRT. Return to the Netflix tab, choose that SRT under **3. Display translated subtitles**, and
seek or play normally to verify synchronization.
The file picker accepts multiple TTML/XML files at once. Each source remains a separate episode
and produces its own source CSV, translated CSV, SRT, quality report, and summary. An `E4`-style
episode number in the filename is carried into the output name automatically.

If the candidate count stays at zero, the selected track may already be cached or Netflix may be
using a transport this lightweight Fetch/XHR probe cannot observe. This result is still useful:
it means a different diagnostic approach is required before building the converter.

## Capture Netflix subtitles

1. Enable the source subtitle language in Netflix's own subtitle menu.
2. Open the extension and choose the capture playback speed.
3. Select **Start new capture**, then play the episode from the desired position.
4. Select **Stop capture** at the end.
5. Download `captured_subs.csv` for the episode splitter/translator or download an SRT directly.

Set **Downloads subfolder** once in the popup. The value is saved in Chrome extension storage, and
future CSV/SRT files are downloaded there automatically without a Save As prompt. The path is
relative to Chrome's Downloads directory; an empty value uses the Downloads root. Existing names
are preserved by adding a unique suffix instead of overwriting files.

The capture engine reads Netflix's rendered native captions first. If no native caption is
visible, it falls back to Language Reactor's `#lln-subs-content` element. A backward timeline jump
of more than ten seconds creates a new segment while preserving row order, so the existing Python
episode splitter can separate consecutive episodes. Starting a new capture clears the previous
capture; page reload also clears it.

## Display translated subtitles

1. Open and play a Netflix or YouTube video.
2. Open the extension from Chrome's toolbar.
3. Choose a translated `.srt` file.
4. Adjust timing, font size, or height from the popup when needed.
5. Enter fullscreen normally. Both subtitles and the playback probe move into the fullscreen
   surface automatically.

The playback diagnostic panel is hidden by default so it does not cover the video. Enable
**Show playback diagnostic panel** in the popup only when testing synchronization details.

Positive timing offset delays subtitles. Negative timing offset displays them earlier. The
selected file stays loaded until the page is reloaded or **Remove loaded subtitles** is used.

## Pass criteria

- Playback time follows the player and freezes while paused.
- Seeking immediately selects the cue at the new time.
- SRT text appears only between each cue's start and end timestamps.
- Timing offset, font size, and height controls update the overlay.
- Subtitles remain visible in fullscreen.
