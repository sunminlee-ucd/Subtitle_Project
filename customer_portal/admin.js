(() => {
  "use strict";
  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  let user = null;
  let profiles = [];
  let tracks = [];
  let pendingGrantCustomerId = "";

  document.addEventListener("DOMContentLoaded", init);
  async function init() {
    $("setupNotice").hidden = client.isConfigured();
    $("signIn").addEventListener("click", signIn); $("signOut").addEventListener("click", signOut);
    $("requestPasswordReset").addEventListener("click", requestPasswordReset);
    $("savePassword").addEventListener("click", savePassword);
    $("cancelPasswordReset").addEventListener("click", cancelPasswordReset);
    $("trackForm").addEventListener("submit", saveTrack); $("grantAccess").addEventListener("click", grantAccess);
    $("newSubtitle").addEventListener("click", startNewSubtitle);
    $("librarySearch").addEventListener("input", renderLibrary);
    $("refreshLibrary").addEventListener("click", loadDashboard);
    $("revokeAccess").addEventListener("click", revokeAccess); $("refresh").addEventListener("click", loadDashboard);
    const recovery = client.isConfigured() ? client.recoverySessionFromUrl() : null;
    if (recovery) { await showPasswordReset(recovery); return; }
    const session = client.isConfigured() ? await client.validSession() : null; await setSession(session);
  }
  async function signIn() {
    try {
      const session = await client.signIn($("email").value.trim(), $("password").value);
      const admin = await client.select("admin_users", `select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`);
      if (!admin?.length) { await client.signOut(); throw new Error("This account is not an administrator."); }
      await setSession(session); $("authStatus").textContent="";
    } catch (error) { $("authStatus").textContent=error.message; }
  }
  async function signOut() { await client.signOut(); await setSession(null); }
  async function requestPasswordReset() {
    const email=$("email").value.trim();
    if(!email){$("authStatus").textContent="Enter your administrator email first.";return;}
    $("authStatus").textContent="Sending secure password link…";
    try {
      const redirectTo=`${location.origin}/admin?recovery=1`;
      await client.requestPasswordReset(email,redirectTo);
      $("authStatus").textContent="Check your email for the password setup link.";
    } catch(error){$("authStatus").textContent=error.message;}
  }
  async function showPasswordReset(session) {
    try {
      const user=await fetch(`${CUSTOMER_APP_CONFIG.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:CUSTOMER_APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`}}).then(async(response)=>{const value=await response.json();if(!response.ok)throw new Error(value.message||"The password link is invalid.");return value;});
      const admin=await client.select("admin_users",`select=user_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);
      if(!admin?.length)throw new Error("This account is not an administrator.");
      $("auth").hidden=true; $("workspace").hidden=true; $("passwordReset").hidden=false;
    } catch(error){await client.signOut();$("authStatus").textContent=error.message;$("auth").hidden=false;}
  }
  async function savePassword() {
    const password=$("newPassword").value; const confirmation=$("confirmPassword").value;
    if(password.length<12){$("passwordStatus").textContent="Use at least 12 characters.";return;}
    if(password!==confirmation){$("passwordStatus").textContent="The passwords do not match.";return;}
    try { await client.updatePassword(password); await client.signOut(); $("passwordReset").hidden=true; $("auth").hidden=false; $("password").value=""; $("authStatus").textContent="Password saved. Sign in with your new password."; }
    catch(error){$("passwordStatus").textContent=error.message;}
  }
  async function cancelPasswordReset(){await client.signOut();$("passwordReset").hidden=true;$("auth").hidden=false;$("authStatus").textContent="Password setup cancelled.";}
  async function setSession(session) {
    if (session?.user) {
      const admin = await client.select("admin_users", `select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`);
      if (!admin?.length) {
        await client.signOut();
        session = null;
        $("authStatus").textContent = "This account is not an administrator.";
      }
    }
    user=session?.user||null; $("passwordReset").hidden=true; $("auth").hidden=Boolean(user); $("workspace").hidden=!user; $("userEmail").textContent=user?.email||"";
    if (user) await loadDashboard();
  }
  async function loadDashboard() {
    setStatus("Refreshing…");
    try {
      const result = await Promise.all([
        client.select("profiles", "select=id,email,display_name&order=email"),
        client.select("subtitle_tracks", "select=id,language_code,language_name,label,cue_count,storage_path,updated_at,video:videos(id,title,episode_label,provider,provider_video_key)&order=updated_at.desc"),
        client.select("subtitle_grants", "select=customer_id,subtitle_track_id,granted_at,expires_at&order=granted_at.desc"),
        client.select("video_requests", "select=id,provider,video_url,requested_language,notes,status,created_at,customer_id&order=created_at.desc&limit=50"),
        client.select("error_reports", "select=id,category,message,video_url,cue_time_seconds,status,created_at,customer_id&order=created_at.desc&limit=50")
      ]);
      [profiles,tracks] = result; renderSelectors(); renderLibrary(); renderGrants(result[2]); renderCases($("requests"),result[3],"video_requests",["new","reviewing","completed","declined"]); renderCases($("reports"),result[4],"error_reports",["new","reviewing","resolved","closed"]); setStatus("");
    } catch (error) { setStatus(error.message); }
  }
  function renderSelectors() {
    const customer=$("grantCustomer"); customer.replaceChildren();
    profiles.forEach((profile)=>customer.add(new Option(`${profile.display_name||profile.email} · ${profile.email}`,profile.id)));
    if(pendingGrantCustomerId && profiles.some((profile)=>profile.id===pendingGrantCustomerId)) customer.value=pendingGrantCustomerId;
    const track=$("grantTrack"); track.replaceChildren();
    tracks.forEach((row)=>{ const video=Array.isArray(row.video)?row.video[0]:row.video; track.add(new Option(`${video?.title||"Untitled"} ${video?.episode_label||""} · ${row.language_name} (${row.cue_count})`,row.id)); });
  }
  function renderLibrary() {
    const query=$("librarySearch").value.trim().toLocaleLowerCase(); const list=$("library"); list.replaceChildren();
    const visible=tracks.filter((row)=>{const video=Array.isArray(row.video)?row.video[0]:row.video;return [video?.title,video?.episode_label,video?.provider,row.language_code,row.language_name,row.label].filter(Boolean).join(" ").toLocaleLowerCase().includes(query);});
    for(const row of visible){const video=Array.isArray(row.video)?row.video[0]:row.video;const item=document.createElement("article");item.className="list-item";const title=document.createElement("strong");title.textContent=`${video?.title||"Untitled"}${video?.episode_label?` · ${video.episode_label}`:""}`;const detail=document.createElement("p");detail.textContent=`${video?.provider||"other"} · ${row.language_name} (${row.language_code}) · ${row.label} · ${row.cue_count} lines · ${row.storage_path?"Private SRT stored":"Legacy subtitle data"}`;const edit=document.createElement("button");edit.type="button";edit.className="secondary";edit.textContent="Edit / replace SRT";edit.addEventListener("click",()=>editTrack(row,video));item.append(title,detail,edit);list.append(item);}if(!visible.length)list.textContent=query?"No subtitles match this search.":"No subtitles have been saved yet.";
  }
  function editTrack(track,video){$("editingTrackId").value=track.id;$("videoKey").value=video?.provider_video_key||"";$("provider").value=video?.provider||"other";$("title").value=video?.title||"";$("episode").value=video?.episode_label||"";$("languageCode").value=track.language_code;$("languageName").value=track.language_name;$("trackLabel").value=track.label;$("srtFile").value="";$("trackForm").scrollIntoView({behavior:"smooth",block:"start"});setStatus("Editing saved subtitle. Choose an SRT file to replace it.");}
  function startNewSubtitle(){const form=$("trackForm");form.reset();$("trackLabel").value="Default";$("videoKey").value="";$("editingTrackId").value="";setStatus("Ready to add a new subtitle. A unique video ID will be generated automatically.");}
  async function saveTrack(event) {
    event.preventDefault(); const form=event.currentTarget; setStatus("Reading and saving SRT…");
    try {
      const file=$("srtFile").files[0]; const srt=await file.text(); const cues=parseSrt(srt);
      const videoKey=$("videoKey").value||crypto.randomUUID(); $("videoKey").value=videoKey;
      const videos=await client.upsert("videos",{provider:$("provider").value,provider_video_key:videoKey,title:$("title").value.trim(),episode_label:$("episode").value.trim()},"on_conflict=provider,provider_video_key");
      const video=videos?.[0]; if(!video) throw new Error("The video record could not be saved.");
      const trackPayload={video_id:video.id,language_code:$("languageCode").value.trim().toLowerCase(),language_name:$("languageName").value.trim(),label:$("trackLabel").value.trim(),cues};
      const editingId=$("editingTrackId").value; const saved=editingId?await client.update("subtitle_tracks",trackPayload,`id=eq.${encodeURIComponent(editingId)}`):await client.upsert("subtitle_tracks",trackPayload,"on_conflict=video_id,language_code,label");
      const track=saved?.[0]; if(!track) throw new Error("The subtitle record could not be saved.");
      const storagePath=`${track.id}.srt`;
      await client.uploadStorage("subtitle-files",storagePath,new Blob([srt],{type:"application/x-subrip"}),"application/x-subrip");
      await client.update("subtitle_tracks",{storage_path:storagePath},`id=eq.${encodeURIComponent(track.id)}`);
      startNewSubtitle(); await loadDashboard(); setStatus(`${cues.length} subtitle lines saved to private storage. Select the customer and subtitle below, then grant access.`);
    } catch (error) { setStatus(error.message); }
  }
  function parseSrt(raw) {
    const cues=[]; const normalized=String(raw).replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").trim();
    for(const block of normalized.split(/\n{2,}/)){ const lines=block.split("\n"); const index=lines.findIndex((line)=>line.includes("-->")); if(index<0)continue; const match=lines[index].match(/^(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})\s*-->\s*(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})/); const text=lines.slice(index+1).join("\n").trim(); if(!match||!text)continue; const start=seconds(match[1]); const end=seconds(match[2]); if(end>start)cues.push({start,end,text}); }
    if(!cues.length)throw new Error("No valid subtitle lines were found in the SRT file."); return cues;
  }
  function seconds(value){const [h,m,tail]=value.replace(",",".").split(":");return Number(h)*3600+Number(m)*60+Number(tail);}
  async function grantAccess(){try{await client.upsert("subtitle_grants",{customer_id:$("grantCustomer").value,subtitle_track_id:$("grantTrack").value,granted_by:user.id},"on_conflict=customer_id,subtitle_track_id");pendingGrantCustomerId=$("grantCustomer").value;setStatus("Access granted. The subtitle is now available to this customer in authorized clients.");await loadDashboard();}catch(error){setStatus(error.message);}}
  async function revokeAccess(){try{await client.remove("subtitle_grants",`customer_id=eq.${encodeURIComponent($("grantCustomer").value)}&subtitle_track_id=eq.${encodeURIComponent($("grantTrack").value)}`);setStatus("Access revoked.");await loadDashboard();}catch(error){setStatus(error.message);}}
  function renderGrants(rows){const list=$("grants");list.replaceChildren();for(const row of rows||[]){const profile=profiles.find((item)=>item.id===row.customer_id);const track=tracks.find((item)=>item.id===row.subtitle_track_id);const video=Array.isArray(track?.video)?track.video[0]:track?.video;const item=document.createElement("div");item.className="list-item";item.textContent=`${profile?.email||row.customer_id} → ${video?.title||"Unknown"} · ${track?.language_name||row.subtitle_track_id}`;list.append(item);}if(!rows?.length)list.textContent="No customer access has been granted yet.";}
  function parseRequestDetails(raw){const details={title:"",season:"",episode:""};for(const line of String(raw||"").split(/\r?\n/)){const match=line.match(/^(Title|Season|Episode):\s*(.*)$/i);if(match)details[match[1].toLowerCase()]=match[2].trim();}return details;}
  function customerLabel(customerId){const profile=profiles.find((item)=>item.id===customerId);return profile?.display_name?`${profile.display_name} · ${profile.email}`:profile?.email||customerId||"Unknown customer";}
  function prepareAccessForRequest(row){pendingGrantCustomerId=row.customer_id||"";if(pendingGrantCustomerId)$("grantCustomer").value=pendingGrantCustomerId;const details=parseRequestDetails(row.notes);const requested=[details.title,details.season,details.episode].filter(Boolean).join(" · ")||"this request";setStatus(`Prepared ${customerLabel(row.customer_id)} for access. Upload ${requested}, then choose the saved subtitle and click Grant access.`);$("trackForm").scrollIntoView({behavior:"smooth",block:"start"});}
  function renderCases(container,rows,table,statuses){container.replaceChildren();for(const row of rows||[]){const item=document.createElement("article");item.className="list-item";const details=table==="video_requests"?parseRequestDetails(row.notes):null;const title=document.createElement("strong");title.textContent=table==="video_requests"?[details?.title||row.provider,details?.season,details?.episode,`· ${row.requested_language}`].filter(Boolean).join(" "):`${row.category}${row.cue_time_seconds!=null?` · ${row.cue_time_seconds}s`:""}`;const owner=document.createElement("small");owner.className="muted";owner.textContent=`Customer: ${customerLabel(row.customer_id)}`;const text=document.createElement("p");text.textContent=row.notes||row.message||row.video_url;const select=document.createElement("select");statuses.forEach((status)=>select.add(new Option(status,status,status===row.status,status===row.status)));select.addEventListener("change",async()=>{try{await client.update(table,{status:select.value},`id=eq.${encodeURIComponent(row.id)}`);setStatus("Status updated.");}catch(error){setStatus(error.message);}});item.append(title,owner,text);if(table==="video_requests"){const prepare=document.createElement("button");prepare.type="button";prepare.className="secondary";prepare.textContent="Prepare access";prepare.addEventListener("click",()=>prepareAccessForRequest(row));item.append(prepare);}item.append(select);container.append(item);}if(!rows?.length)container.textContent="Nothing waiting.";}
  function setStatus(message){$("status").textContent=message;}
})();
