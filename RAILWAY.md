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
| `WFCONNECT_API_KEY` | WF Connect — syncs applications → Workers |
| `WEEKDAYS_API_BASE_URL` | Override the CRM base URL (optional) |
| `WFCONNECT_API_BASE_URL` | Override the WF Connect base URL (optional) |

### Sync endpoints

Trigger a sync manually (requires a logged-in session or an internal call):

```
POST /api/sync/hotels    # pulls workplaces from Weekdays CRM
POST /api/sync/workers   # pulls applications from WF Connect
GET  /api/sync/status    # returns current counts of workers and hotels
```

Legacy Render DB sync is still available as a fallback:

```
POST /api/sync/hotels?source=render
POST /api/sync/workers?source=render
```

This requires `RENDER_DATABASE_URL` to be set.

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
