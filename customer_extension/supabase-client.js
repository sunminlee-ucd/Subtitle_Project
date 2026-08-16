(() => {
  "use strict";

  const SESSION_KEY = "subtitleCustomerSession";

  function configured(config) {
    return Boolean(
      config?.SUPABASE_URL?.startsWith("https://") &&
      !config.SUPABASE_URL.includes("YOUR_PROJECT_REF") &&
      config?.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")
    );
  }

  function storageGet(key) {
    if (globalThis.chrome?.storage?.local) {
      return chrome.storage.local.get(key).then((result) => result[key] || null);
    }
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(key) || "null"));
    } catch {
      return Promise.resolve(null);
    }
  }

  function storageSet(key, value) {
    if (globalThis.chrome?.storage?.local) {
      return chrome.storage.local.set({ [key]: value });
    }
    localStorage.setItem(key, JSON.stringify(value));
    return Promise.resolve();
  }

  function storageRemove(key) {
    if (globalThis.chrome?.storage?.local) {
      return chrome.storage.local.remove(key);
    }
    localStorage.removeItem(key);
    return Promise.resolve();
  }

  class SupabaseRestClient {
    constructor(config) {
      this.config = config;
      this.baseUrl = String(config?.SUPABASE_URL || "").replace(/\/$/, "");
      this.publishableKey = String(config?.SUPABASE_PUBLISHABLE_KEY || "");
    }

    isConfigured() {
      return configured(this.config);
    }

    async session() {
      return storageGet(SESSION_KEY);
    }

    async signUp(email, password, displayName = "") {
      return this.authRequest("/auth/v1/signup", {
        email,
        password,
        data: { display_name: displayName }
      });
    }

    async signIn(email, password) {
      const session = await this.authRequest("/auth/v1/token?grant_type=password", {
        email,
        password
      });
      await this.saveSession(session);
      return session;
    }

    async signOut() {
      const session = await this.session();
      if (session?.access_token) {
        await fetch(`${this.baseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: this.headers(session.access_token)
        }).catch(() => null);
      }
      await storageRemove(SESSION_KEY);
    }

    async authRequest(path, body) {
      this.assertConfigured();
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.headers(null, true),
        body: JSON.stringify(body)
      });
      return this.readResponse(response);
    }

    async saveSession(session) {
      const expiresIn = Number(session?.expires_in || 3600);
      await storageSet(SESSION_KEY, {
        ...session,
        expires_at_ms: Date.now() + expiresIn * 1000
      });
    }

    async validSession() {
      let session = await this.session();
      if (!session?.access_token) {
        return null;
      }
      if (session.expires_at_ms > Date.now() + 60_000) {
        return session;
      }
      if (!session.refresh_token) {
        await storageRemove(SESSION_KEY);
        return null;
      }
      try {
        session = await this.authRequest("/auth/v1/token?grant_type=refresh_token", {
          refresh_token: session.refresh_token
        });
        await this.saveSession(session);
        return session;
      } catch {
        await storageRemove(SESSION_KEY);
        return null;
      }
    }

    async currentUser() {
      const session = await this.validSession();
      return session?.user || null;
    }

    async select(table, query = "") {
      return this.dataRequest("GET", table, query);
    }

    async insert(table, body, query = "", prefer = "return=representation") {
      return this.dataRequest("POST", table, query, body, prefer);
    }

    async upsert(table, body, query = "") {
      return this.dataRequest(
        "POST",
        table,
        query,
        body,
        "resolution=merge-duplicates,return=representation"
      );
    }

    async update(table, body, query = "") {
      return this.dataRequest("PATCH", table, query, body, "return=representation");
    }

    async remove(table, query = "") {
      return this.dataRequest("DELETE", table, query, null, "return=minimal");
    }

    async dataRequest(method, table, query = "", body = null, prefer = "") {
      this.assertConfigured();
      const session = await this.validSession();
      if (!session?.access_token) {
        throw new Error("Please sign in first.");
      }
      const suffix = query ? `?${query}` : "";
      const headers = this.headers(session.access_token, body !== null);
      if (prefer) {
        headers.Prefer = prefer;
      }
      const response = await fetch(`${this.baseUrl}/rest/v1/${table}${suffix}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body)
      });
      return this.readResponse(response);
    }

    headers(accessToken = null, json = false) {
      const headers = { apikey: this.publishableKey };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }
      if (json) {
        headers["Content-Type"] = "application/json";
      }
      return headers;
    }

    async readResponse(response) {
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }
      if (!response.ok) {
        const detail = payload?.msg || payload?.message || payload?.error_description || text;
        throw new Error(detail || `Request failed (${response.status}).`);
      }
      return payload;
    }

    assertConfigured() {
      if (!this.isConfigured()) {
        throw new Error("Supabase project URL and publishable key are not configured.");
      }
    }
  }

  globalThis.CustomerSupabase = { SupabaseRestClient, configured };
})();
