# Customer and admin portal

The FastAPI app serves:

- `http://127.0.0.1:8000/customer` — customer sign-in, video request, and error report
- `http://127.0.0.1:8000/admin` — subtitle library upload and customer access control

Production Cloud Run URLs:

- `https://subtitle-project-978670366914.europe-west2.run.app/customer`
- `https://subtitle-project-978670366914.europe-west2.run.app/admin`

The browser receives only a Supabase publishable key. Database RLS remains the authorization boundary.
