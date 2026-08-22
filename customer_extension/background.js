importScripts("config.js", "supabase-client.js", "google-oauth.js", "subtitle-core.js");

const client = new CustomerSupabase.SupabaseRestClient(CUSTOMER_APP_CONFIG);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CUSTOMER_GOOGLE_SIGN_IN") {
    CustomerGoogleOAuth.launch(client)
      .then(({ session, redirectUrl }) => sendResponse({
        ok: true,
        email: session?.user?.email || "",
        redirectUrl
      }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type !== "CUSTOMER_CONTENT_READY") return false;
  restoreSelectedTracks(sender.tab?.id)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function restoreSelectedTracks(tabId) {
  if (!tabId || !client.isConfigured()) return;
  const stored = await chrome.storage.local.get([
    "selectedTrackId",
    "selectedTrackLabel",
    "secondaryTrackId",
    "secondaryTrackLabel"
  ]);
  if (stored.selectedTrackId) {
    await restoreTrack(tabId, stored.selectedTrackId, stored.selectedTrackLabel, "primary");
  }
  if (stored.secondaryTrackId) {
    await restoreTrack(tabId, stored.secondaryTrackId, stored.secondaryTrackLabel, "secondary");
  }
}

async function restoreTrack(tabId, trackId, label, slot) {
  const rows = await client.select(
    "subtitle_tracks",
    `select=id,storage_path,cues&id=eq.${encodeURIComponent(trackId)}&limit=1`
  );
  if (!rows?.[0]) return;
  const cues = rows[0].storage_path
    ? CustomerSubtitleCore.parseSrt(await client.downloadStorageText("subtitle-files", rows[0].storage_path))
    : CustomerSubtitleCore.normalizeCues(rows[0].cues);
  await chrome.tabs.sendMessage(tabId, {
    type: "LOAD_AUTHORIZED_TRACK",
    slot,
    trackId: rows[0].id,
    label: label || "Authorized subtitle",
    cues
  });
}
