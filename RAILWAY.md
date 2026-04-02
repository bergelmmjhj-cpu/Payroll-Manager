# Railway Deployment

This repository now supports a single-service Railway deployment where the API server also serves the built payroll frontend.

## Recommended service shape

- Runtime: `@workspace/api-server`
- Frontend: built from `artifacts/payroll` and served by Express
- Database: Railway PostgreSQL

## Railway commands

- Build command: `pnpm run build:railway`
- Start command: `pnpm run start:railway`

## Required environment variables

Copy values from `.env.example` and set them in Railway:

- `NODE_ENV=production`
- `PORT=8080`
- `DATABASE_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_ORIGIN=https://<your-railway-domain>`

Optional:

- `GOOGLE_CALLBACK_URL` if you need a callback URL that differs from `APP_ORIGIN`
- `VITE_API_BASE_URL` only when the frontend must call an API on a different origin

## Data integrations

Workers and Hotels/Sites are populated by syncing from external APIs. Set these variables to enable sync:

| Variable | Purpose |
|---|---|
| `WEEKDAYS_API_KEY` | Weekdays CRM — syncs workplaces → Hotels/Sites |
| `PAYROLL_API_KEY` | WF Connect Payroll key (preferred) — syncs applications → Workers |
| `WFCONNECT_API_KEY` | WF Connect key fallback (used only if `PAYROLL_API_KEY` is missing) |
| `WEEKDAYS_API_BASE_URL` | Override the CRM base URL (optional) |
| `WFCONNECT_API_BASE_URL` | Override the WF Connect base URL (optional) |

### Sync endpoints

Trigger a sync manually (requires a logged-in session or an internal call):

```
POST /api/sync/hotels    # pulls workplaces from Weekdays CRM
POST /api/sync/workers   # pulls applications from WF Connect
GET  /api/sync/status    # returns current counts of workers and hotels
GET  /api/health/wfconnect  # validates WF Connect auth and returns application row count
```

Legacy Render DB sync is also available through `RENDER_DATABASE_URL`.

- Workers automatically fall back to Render when both `PAYROLL_API_KEY` and `WFCONNECT_API_KEY` are missing.
- Hotels automatically fall back to Render when `WEEKDAYS_API_KEY` is missing.
- You can still force the legacy source explicitly with these endpoints:

```
POST /api/sync/hotels?source=render
POST /api/sync/workers?source=render
```

This requires `RENDER_DATABASE_URL` to be set.

## Payroll integration runbook

Use this runtime contract for Workforce Connect Payroll:

- Base URL: `https://guide.wfconnect.org` (or `WFCONNECT_API_BASE_URL` override)
- Endpoint: `GET /api/admin/applications`
- Auth header: `Authorization: Bearer ${PAYROLL_API_KEY}`
- Required key scope: `applications:read`
- Key format expectation: plaintext key beginning with `wfc_`

Failure actions:

- `401`: key invalid or revoked. Replace key in Railway variables, redeploy, then re-run `GET /api/health/wfconnect`.
- `403`: key missing `applications:read` scope. Grant scope, then re-run `GET /api/health/wfconnect`.
- `5xx` or timeout: integration retries with exponential backoff + jitter; if still failing, treat as upstream outage and retry later.

Key rotation:

1. Update `PAYROLL_API_KEY` in Railway (or `WFCONNECT_API_KEY` if still using fallback).
2. Deploy.
3. Verify with `GET /api/health/wfconnect`.
4. Revoke old key after health check succeeds.

Polling cadence recommendation: run `POST /api/sync/workers` from an external scheduler every 5 to 15 minutes.

## First deploy checklist

1. Provision PostgreSQL in Railway.
2. Set all required environment variables.
3. Run `pnpm run db:push` once against the production database before first boot. This pushes the Drizzle schema and also creates the `sessions` table required by `connect-pg-simple`.
4. Deploy using the build and start commands above.
5. Verify `GET /api/healthz` returns `200`.
6. Verify `/` loads the payroll SPA.
7. Verify Google OAuth callback is configured as `https://<your-railway-domain>/api/auth/google/callback` unless you use `GOOGLE_CALLBACK_URL`.

## Notes

- The current deployment target is the payroll app only. `artifacts/mockup-sandbox` is not part of the Railway runtime.
- The backend still needs route-level auth hardening before exposing the app broadly on the public internet.

## wfconnect-timeclock deployment

The repository also includes a clean scaffold for a new app pair:

- API package: `@workspace/wfconnect-timeclock-api`
- Web package: `@workspace/wfconnect-timeclock-web`

Recommended Railway topology for this pair is two services (one API service and one static web service).

### API service

- Build command: `pnpm run build:railway:wfconnect-timeclock`
- Start command: `pnpm run start:railway:wfconnect-timeclock`
- Required env vars: `NODE_ENV=production`, `PORT=8080`

### Web service

Deploy `artifacts/wfconnect-timeclock-web/dist/public` as a static site after running:

- `pnpm --filter @workspace/wfconnect-timeclock-web run build`

Set the API URL for the web app with:

- `VITE_API_BASE_URL=https://<your-api-domain>`
