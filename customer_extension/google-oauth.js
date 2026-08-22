(() => {
  "use strict";

  const PROVIDER = "google";

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomVerifier() {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function codeChallenge(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  }

  function callbackParams(callbackUrl) {
    const url = new URL(callbackUrl);
    const params = new URLSearchParams(url.search);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    for (const [key, value] of hash.entries()) {
      if (!params.has(key)) params.set(key, value);
    }
    return params;
  }

  function oauthError(params) {
    return params.get("error_description") || params.get("error") || "";
  }

  async function exchangeCode(client, authCode, verifier) {
    const response = await fetch(`${client.baseUrl}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: client.headers(null, true),
      body: JSON.stringify({ auth_code: authCode, code_verifier: verifier })
    });
    return client.readResponse(response);
  }

  async function userFromAccessToken(client, accessToken) {
    const response = await fetch(`${client.baseUrl}/auth/v1/user`, {
      headers: client.headers(accessToken)
    });
    return client.readResponse(response);
  }

  async function implicitSession(client, params) {
    const accessToken = params.get("access_token");
    if (!accessToken) throw new Error("Google sign-in returned no authorization code or access token.");
    const session = {
      access_token: accessToken,
      refresh_token: params.get("refresh_token") || "",
      expires_in: Number(params.get("expires_in") || 3600),
      token_type: params.get("token_type") || "bearer",
      provider_token: params.get("provider_token") || undefined,
      provider_refresh_token: params.get("provider_refresh_token") || undefined,
      user: await userFromAccessToken(client, accessToken)
    };
    await client.saveSession(session);
    return session;
  }

  async function launch(client) {
    if (!client?.isConfigured?.()) {
      throw new Error("Supabase project URL and publishable key are not configured.");
    }
    if (!chrome.identity?.launchWebAuthFlow) {
      throw new Error("Chrome Identity is unavailable. Reload the extension and try again.");
    }

    const redirectUrl = chrome.identity.getRedirectURL("google");
    const verifier = randomVerifier();
    const challenge = await codeChallenge(verifier);
    const authUrl = new URL(`${client.baseUrl}/auth/v1/authorize`);
    authUrl.searchParams.set("provider", PROVIDER);
    authUrl.searchParams.set("redirect_to", redirectUrl);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "s256");

    let callbackUrl;
    try {
      callbackUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true
      });
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/cancel|closed|approve/i.test(message)) {
        throw new Error("Google sign-in was cancelled.");
      }
      throw error;
    }

    if (!callbackUrl) throw new Error("Google sign-in did not return to the extension.");
    const params = callbackParams(callbackUrl);
    const error = oauthError(params);
    if (error) throw new Error(error);

    const authCode = params.get("code");
    let session;
    if (authCode) {
      session = await exchangeCode(client, authCode, verifier);
      await client.saveSession(session);
    } else {
      session = await implicitSession(client, params);
    }
    return { session, redirectUrl };
  }

  globalThis.CustomerGoogleOAuth = {
    launch,
    callbackParams,
    randomVerifier,
    codeChallenge
  };
})();
