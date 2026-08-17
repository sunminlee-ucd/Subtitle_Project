(() => {
  "use strict";
  const client = new PortalSupabase.PortalSupabaseClient(CUSTOMER_APP_CONFIG);
  const $ = (id) => document.getElementById(id);
  let user = null;
  let profiles = [];
  let tracks = [];

  document.addEventListener("DOMContentLoaded", init);
  async function init() {
    $("setupNotice").hidden = client.isConfigured();
    $("signIn").addEventListener("click", signIn); $("signOut").addEventListener("click", signOut);
    $("requestPasswordReset").addEventListener("click", requestPasswordReset);
    $("savePassword").addEventListener("click", savePassword);
    $("cancelPasswordReset").addEventListener("click", cancelPasswordReset);
    $("trackForm").addEventListener("submit", saveTrack); $("grantAccess").addEventListener("click", grantAccess);
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
        client.select("subtitle_tracks", "select=id,language_code,language_name,label,cue_count,video:videos(title,episode_label,provider)&order=updated_at.desc"),
        client.select("subtitle_grants", "select=customer_id,subtitle_track_id,granted_at,expires_at&order=granted_at.desc"),
        client.select("video_requests", "select=id,provider,video_url,requested_language,notes,status,created_at,customer_id&order=created_at.desc&limit=50"),
        client.select("error_reports", "select=id,category,message,video_url,cue_time_seconds,status,created_at,customer_id&order=created_at.desc&limit=50")
      ]);
      [profiles,tracks] = result; renderSelectors(); renderGrants(result[2]); renderCases($("requests"),result[3],"video_requests",["new","reviewing","completed","declined"]); renderCases($("reports"),result[4],"error_reports",["new","reviewing","resolved","closed"]); setStatus("");
    } catch (error) { setStatus(error.message); }
  }
  function renderSelectors() {
    const customer=$("grantCustomer"); customer.replaceChildren();
    profiles.forEach((profile)=>customer.add(new Option(`${profile.display_name||profile.email} · ${profile.email}`,profile.id)));
    const track=$("grantTrack"); track.replaceChildren();
    tracks.forEach((row)=>{ const video=Array.isArray(row.video)?row.video[0]:row.video; track.add(new Option(`${video?.title||"Untitled"} ${video?.episode_label||""} · ${row.language_name} (${row.cue_count})`,row.id)); });
  }
  async function saveTrack(event) {
    event.preventDefault(); const form=event.currentTarget; setStatus("Reading and saving SRT…");
    try {
      const file=$("srtFile").files[0]; const srt=await file.text(); const cues=parseSrt(srt);
      const videos=await client.upsert("videos",{provider:$("provider").value,provider_video_key:$("videoKey").value.trim(),title:$("title").value.trim(),episode_label:$("episode").value.trim()},"on_conflict=provider,provider_video_key");
      const video=videos?.[0]; if(!video) throw new Error("The video record could not be saved.");
      const saved=await client.upsert("subtitle_tracks",{video_id:video.id,language_code:$("languageCode").value.trim().toLowerCase(),language_name:$("languageName").value.trim(),label:$("trackLabel").value.trim(),cues},"on_conflict=video_id,language_code,label");
      const track=saved?.[0]; if(!track) throw new Error("The subtitle record could not be saved.");
      const storagePath=`${track.id}.srt`;
      await client.uploadStorage("subtitle-files",storagePath,new Blob([srt],{type:"application/x-subrip"}),"application/x-subrip");
      await client.update("subtitle_tracks",{storage_path:storagePath},`id=eq.${encodeURIComponent(track.id)}`);
      form.reset(); $("trackLabel").value="Default"; setStatus(`${cues.length} subtitle lines saved to private storage.`); await loadDashboard();
    } catch (error) { setStatus(error.message); }
  }
  function parseSrt(raw) {
    const cues=[]; const normalized=String(raw).replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").trim();
    for(const block of normalized.split(/\n{2,}/)){ const lines=block.split("\n"); const index=lines.findIndex((line)=>line.includes("-->")); if(index<0)continue; const match=lines[index].match(/^(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})\s*-->\s*(\d{1,3}:[0-5]\d:[0-5]\d[,.]\d{1,3})/); const text=lines.slice(index+1).join("\n").trim(); if(!match||!text)continue; const start=seconds(match[1]); const end=seconds(match[2]); if(end>start)cues.push({start,end,text}); }
    if(!cues.length)throw new Error("No valid subtitle lines were found in the SRT file."); return cues;
  }
  function seconds(value){const [h,m,tail]=value.replace(",",".").split(":");return Number(h)*3600+Number(m)*60+Number(tail);}
  async function grantAccess(){try{await client.upsert("subtitle_grants",{customer_id:$("grantCustomer").value,subtitle_track_id:$("grantTrack").value,granted_by:user.id},"on_conflict=customer_id,subtitle_track_id");setStatus("Access granted.");await loadDashboard();}catch(error){setStatus(error.message);}}
  async function revokeAccess(){try{await client.remove("subtitle_grants",`customer_id=eq.${encodeURIComponent($("grantCustomer").value)}&subtitle_track_id=eq.${encodeURIComponent($("grantTrack").value)}`);setStatus("Access revoked.");await loadDashboard();}catch(error){setStatus(error.message);}}
  function renderGrants(rows){const list=$("grants");list.replaceChildren();for(const row of rows||[]){const profile=profiles.find((item)=>item.id===row.customer_id);const track=tracks.find((item)=>item.id===row.subtitle_track_id);const video=Array.isArray(track?.video)?track.video[0]:track?.video;const item=document.createElement("div");item.className="list-item";item.textContent=`${profile?.email||row.customer_id} → ${video?.title||"Unknown"} · ${track?.language_name||row.subtitle_track_id}`;list.append(item);}if(!rows?.length)list.textContent="No customer access has been granted yet.";}
  function renderCases(container,rows,table,statuses){container.replaceChildren();for(const row of rows||[]){const item=document.createElement("article");item.className="list-item";const title=document.createElement("strong");title.textContent=table==="video_requests"?`${row.provider} · ${row.requested_language}`:`${row.category}${row.cue_time_seconds!=null?` · ${row.cue_time_seconds}s`:""}`;const text=document.createElement("p");text.textContent=row.notes||row.message||row.video_url;const select=document.createElement("select");statuses.forEach((status)=>select.add(new Option(status,status,status===row.status,status===row.status)));select.addEventListener("change",async()=>{try{await client.update(table,{status:select.value},`id=eq.${encodeURIComponent(row.id)}`);setStatus("Status updated.");}catch(error){setStatus(error.message);}});item.append(title,text,select);container.append(item);}if(!rows?.length)container.textContent="Nothing waiting.";}
  function setStatus(message){$("status").textContent=message;}
})();
