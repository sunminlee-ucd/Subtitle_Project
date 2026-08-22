# Customer extension Google sign-in setup

The extension uses Supabase Google OAuth through `chrome.identity.launchWebAuthFlow()` with PKCE. No Google Client Secret is stored in the extension.

## One-time setup

1. Load or reload `customer_extension` from `chrome://extensions` and copy its Extension ID.
2. In Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, add:

   `https://<EXTENSION_ID>.chromiumapp.org/google`

3. In Supabase Dashboard → Authentication → Providers → Google, keep Google enabled with the existing Google OAuth Client ID and Client Secret.
4. In Google Cloud, the authorized redirect URI remains the Supabase callback:

   `https://qtpxlrnazsonqdljafkd.supabase.co/auth/v1/callback`

Do not add the `chromiumapp.org` URL to Google Cloud. Google returns to Supabase first, and Supabase returns to the extension callback.

## Flow

`Customer extension → Supabase → Google → Supabase → chromiumapp.org/google → extension session`

The resulting Supabase access and refresh tokens are stored in the same `subtitleCustomerSession` used by email/password sign-in, so existing RLS and authorized subtitle access remain unchanged.
