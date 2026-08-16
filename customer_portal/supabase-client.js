(() => {
  "use strict";
  const SESSION_KEY = "subtitlePortalSession";

  class PortalSupabaseClient {
    constructor(config) {
      this.baseUrl = String(config?.SUPABASE_URL || "").replace(/\/$/, "");
      this.key = String(config?.SUPABASE_PUBLISHABLE_KEY || "");
    }
    isConfigured() {
      return this.baseUrl.startsWith("https://") && !this.baseUrl.includes("YOUR_PROJECT_REF") && this.key.startsWith("sb_publishable_");
    }
    session() {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
    }
    saveSession(session) {
      const saved = { ...session, expires_at_ms: Date.now() + Number(session.expires_in || 3600) * 1000 };
      localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
      return saved;
    }
    async signIn(email, password) {
      const session = await this.auth("/auth/v1/token?grant_type=password", { email, password });
      return this.saveSession(session);
    }
    async signUp(email, password, displayName) {
      return this.auth("/auth/v1/signup", { email, password, data: { display_name: displayName } });
    }
    async signOut() {
      const session = this.session();
      if (session?.access_token) {
        await fetch(`${this.baseUrl}/auth/v1/logout`, { method: "POST", headers: this.headers(session.access_token) }).catch(() => null);
      }
      localStorage.removeItem(SESSION_KEY);
    }
    async validSession() {
      let session = this.session();
      if (!session?.access_token) return null;
      if (session.expires_at_ms > Date.now() + 60_000) return session;
      if (!session.refresh_token) return null;
      try {
        session = await this.auth("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
        return this.saveSession(session);
      } catch {
        localStorage.removeItem(SESSION_KEY);
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
})();
