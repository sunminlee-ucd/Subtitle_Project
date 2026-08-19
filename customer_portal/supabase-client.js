(() => {
  "use strict";

  class PortalSupabaseClient {
    constructor(config) {
      this.baseUrl = String(config?.SUPABASE_URL || "").replace(/\/$/, "");
      this.key = String(config?.SUPABASE_PUBLISHABLE_KEY || "");
      const isAdmin = String(globalThis.location?.pathname || "").startsWith("/admin");
      this.sessionKey = isAdmin ? "subtitlePortalAdminSession" : "subtitlePortalCustomerSession";
    }
    isConfigured() {
      return this.baseUrl.startsWith("https://") && !this.baseUrl.includes("YOUR_PROJECT_REF") && this.key.startsWith("sb_publishable_");
    }
    readStoredSession(storage) {
      try { return JSON.parse(storage.getItem(this.sessionKey) || "null"); } catch { return null; }
    }
    session() {
      return this.readStoredSession(sessionStorage) || this.readStoredSession(localStorage);
    }
    isPersistentSession() {
      return !this.readStoredSession(sessionStorage) && Boolean(this.readStoredSession(localStorage));
    }
    clearStoredSession() {
      sessionStorage.removeItem(this.sessionKey);
      localStorage.removeItem(this.sessionKey);
    }
    saveSession(session, persistent = this.isPersistentSession()) {
      const saved = { ...session, expires_at_ms: Date.now() + Number(session.expires_in || 3600) * 1000 };
      const target = persistent ? localStorage : sessionStorage;
      const other = persistent ? sessionStorage : localStorage;
      target.setItem(this.sessionKey, JSON.stringify(saved));
      other.removeItem(this.sessionKey);
      return saved;
    }
    async signIn(email, password, persistent = null) {
      const session = await this.auth("/auth/v1/token?grant_type=password", { email, password });
      const remember = persistent ?? Boolean(document.getElementById("rememberLogin")?.checked);
      return this.saveSession(session, remember);
    }
    async signUp(email, password) {
      return this.auth("/auth/v1/signup", { email, password });
    }
    async requestPasswordReset(email, redirectTo) {
      this.assertConfigured();
      const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
      return this.read(await fetch(`${this.baseUrl}/auth/v1/recover${query}`, {
        method: "POST", headers: this.headers(null, true), body: JSON.stringify({ email })
      }));
    }
    recoverySessionFromUrl() {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
      if (hash.get("type") !== "recovery" || !hash.get("access_token")) return null;
      const session = this.saveSession({
        access_token: hash.get("access_token"),
        refresh_token: hash.get("refresh_token") || "",
        expires_in: Number(hash.get("expires_in") || 3600),
        token_type: hash.get("token_type") || "bearer",
        user: null
      }, false);
      history.replaceState(null, "", `${location.pathname}?recovery=1`);
      return session;
    }
    async updatePassword(password) {
      const session = await this.validSession();
      if (!session?.access_token) throw new Error("The password link has expired. Request a new one.");
      return this.read(await fetch(`${this.baseUrl}/auth/v1/user`, {
        method: "PUT", headers: this.headers(session.access_token, true), body: JSON.stringify({ password })
      }));
    }
    async signOut() {
      const session = this.session();
      if (session?.access_token) {
        await fetch(`${this.baseUrl}/auth/v1/logout`, { method: "POST", headers: this.headers(session.access_token) }).catch(() => null);
      }
      this.clearStoredSession();
    }
    async validSession() {
      const persistent = this.isPersistentSession();
      let session = this.session();
      if (!session?.access_token) return null;
      if (session.expires_at_ms > Date.now() + 60_000) return session;
      if (!session.refresh_token) return session.expires_at_ms > Date.now() ? session : null;
      try {
        session = await this.auth("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
        return this.saveSession(session, persistent);
      } catch {
        this.clearStoredSession();
        return null;
      }
    }
    async auth(path, body) {
      this.assertConfigured();
      return this.read(await fetch(`${this.baseUrl}${path}`, {
        method: "POST", headers: this.headers(null, true), body: JSON.stringify(body)
      }));
    }
    async select(table, query = "") { return this.data("GET", table, query); }
    async insert(table, body, query = "", prefer = "return=representation") { return this.data("POST", table, query, body, prefer); }
    async upsert(table, body, query = "") { return this.data("POST", table, query, body, "resolution=merge-duplicates,return=representation"); }
    async update(table, body, query = "") { return this.data("PATCH", table, query, body, "return=representation"); }
    async remove(table, query = "") { return this.data("DELETE", table, query, null, "return=minimal"); }
    async rpc(functionName, body = {}) {
      this.assertConfigured();
      const session = await this.validSession();
      if (!session) throw new Error("Please sign in first.");
      return this.read(await fetch(
        `${this.baseUrl}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
        {
          method: "POST",
          headers: this.headers(session.access_token, true),
          body: JSON.stringify(body),
        }
      ));
    }
    async uploadStorage(bucket, path, body, contentType = "application/octet-stream") {
      this.assertConfigured();
      const session = await this.validSession();
      if (!session) throw new Error("Please sign in first.");
      const objectPath = String(path || "").split("/").map(encodeURIComponent).join("/");
      const headers = this.headers(session.access_token);
      headers["Content-Type"] = contentType;
      headers["x-upsert"] = "true";
      return this.read(await fetch(
        `${this.baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`,
        { method: "POST", headers, body }
      ));
    }
    async data(method, table, query = "", body = null, prefer = "") {
      this.assertConfigured();
      const session = await this.validSession();
      if (!session) throw new Error("Please sign in first.");
      const headers = this.headers(session.access_token, body !== null);
      if (prefer) headers.Prefer = prefer;
      return this.read(await fetch(`${this.baseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`, {
        method, headers, body: body === null ? undefined : JSON.stringify(body)
      }));
    }
    headers(token = null, json = false) {
      const headers = { apikey: this.key };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (json) headers["Content-Type"] = "application/json";
      return headers;
    }
    async read(response) {
      const text = await response.text();
      let value = null;
      try { value = text ? JSON.parse(text) : null; } catch { value = text; }
      if (!response.ok) throw new Error(value?.message || value?.msg || value?.error_description || text || `Request failed (${response.status}).`);
      return value;
    }
    assertConfigured() {
      if (!this.isConfigured()) throw new Error("Supabase project URL and publishable key are not configured.");
    }
  }

  globalThis.PortalSupabase = { PortalSupabaseClient };

  if (typeof document !== "undefined") {
    const pathname = String(globalThis.location?.pathname || "");
    const source = pathname.startsWith("/admin")
      ? "/portal-assets/admin-translation-feedback.js?v=20260819-1"
      : pathname.startsWith("/customer") || pathname === "/"
        ? "/portal-assets/translation-feedback.js?v=20260819-1"
        : "";
    if (source && !document.querySelector(`script[src^="${source.split("?")[0]}"]`)) {
      const script = document.createElement("script");
      script.src = source;
      script.async = false;
      document.head.append(script);
    }
  }
})();
