# Subtitle Companion customer extension

This folder is a separate customer build. It intentionally contains:

- customer sign-in;
- a list of subtitle tracks authorized by database RLS;
- remote subtitle selection and synchronized overlay;
- Watch and Study modes;
- links for video requests and error reports.

It intentionally does **not** contain subtitle capture, track probing, file export, SRT file selection, or Chrome's `downloads` permission.

## Local installation

1. Configure `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `config.js`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `customer_extension` folder.
5. Sign in with a customer account that has at least one `subtitle_grants` row.

Only use a `sb_publishable_...` key here. Never use `sb_secret_...` or `service_role`.

## Download limitation

The extension has no download/export UI or permission. However, subtitles displayed in a browser must reach that browser, so a technically skilled customer can still inspect memory or network traffic. Absolute copying prevention requires a licensed DRM delivery design and still cannot be guaranteed.

Authorized SRT files are read from the private Supabase Storage bucket named `subtitle-files` with the customer's current JWT. Storage RLS checks the same `subtitle_grants` relation used by the library. The extension parses the SRT in memory and does not save it as a local file.
