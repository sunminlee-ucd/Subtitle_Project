# Supabase setup

This is the low-cost MVP data layer for customer authentication and per-customer subtitle access.

1. Create a Supabase project.
2. Run `schema.sql` in **SQL Editor**.
3. Create your administrator in **Authentication > Users**.
4. Run the bootstrap `insert into public.admin_users ...` shown at the bottom of `schema.sql`.
5. Copy only the project URL and `sb_publishable_...` key into both `config.js` files.

Never put an `sb_secret_...` or legacy `service_role` key in the extension or web pages. Customers without a valid row in `subtitle_grants` receive no subtitle track through the Data API.
