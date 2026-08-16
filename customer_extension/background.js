importScripts("config.js", "supabase-client.js");

const client = new CustomerSupabase.SupabaseRestClient(CUSTOMER_APP_CONFIG);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CUSTOMER_CONTENT_READY") {
    return false;
  }
  restoreSelectedTrack(sender.tab?.id)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function restoreSelectedTrack(tabId) {
  if (!tabId || !client.isConfigured()) {
    return;
  }
  const stored = await chrome.storage.local.get(["selectedTrackId", "selectedTrackLabel"]);
  if (!stored.selectedTrackId) {
    return;
  }
  const rows = await client.select(
    "subtitle_tracks",
    `select=id,cues&id=eq.${encodeURIComponent(stored.selectedTrackId)}&limit=1`
  );
  if (!rows?.[0]) {
    return;
  }
  await chrome.tabs.sendMessage(tabId, {
    type: "LOAD_AUTHORIZED_TRACK",
    trackId: rows[0].id,
    label: stored.selectedTrackLabel || "Authorized subtitle",
    cues: rows[0].cues
  });
}
