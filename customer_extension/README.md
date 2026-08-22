# Subtitle Companion customer extension

This folder is the customer-only browser build. It mirrors the Android customer experience while keeping the administrator SRT workflow separate.

## Customer flow

1. A customer signs in with the same Subtitle Companion account used by the customer portal or Android app.
2. The extension lists only `subtitle_tracks` allowed by Supabase RLS and `subtitle_grants`.
3. The customer selects an authorized subtitle, or two different authorized subtitles for Multi Subtitle mode.
4. The private SRT is read with the customer's JWT, parsed in memory, and rendered over the supported streaming page.
5. The extension never exposes an SRT file picker, capture/probe workflow, export action, or Chrome download permission.

## Android-style controls included

- collapsible control panels;
- play/pause and seek backward/forward by five seconds;
- playback speed cycling;
- subtitle visibility;
- 0.5-second sync adjustment;
- subtitle size and vertical position adjustment;
- Watch and Study modes;
- study repeat count from 1 to 20;
- Repeat current, Play saved, Stop, Clear, and a saved-lines list;
- Multi Subtitle with independently adjustable Sub 2 size and position;
- request-subtitle and report-issue links.

## Local installation

1. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `config.js`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `customer_extension` folder.
5. Sign in with a customer account that has at least one `subtitle_grants` row.

Only use a `sb_publishable_...` key here. Never use `sb_secret_...` or `service_role`.

## Customer/admin separation

The administrator build remains separate. Customer code intentionally does **not** contain subtitle capture, track probing, local SRT selection, file export, or Chrome's `downloads` permission. Creating, replacing, or exporting SRT files stays an administrator workflow.

The customer extension can read only tracks that RLS authorizes for the signed-in account. The `subtitle-files` bucket remains private, and Storage RLS checks the same grant relation before returning an object.

## Copying limitation

A subtitle displayed in a browser must reach that browser as plaintext at render time. The extension prevents ordinary file download/export and enforces server-side account authorization, but a technically skilled user can still inspect browser memory or network traffic. Absolute copying prevention would require a licensed DRM delivery design and still cannot be guaranteed.
