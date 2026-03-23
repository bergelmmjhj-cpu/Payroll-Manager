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

## First deploy checklist

1. Provision PostgreSQL in Railway.
2. Set all required environment variables.
3. Run `pnpm run db:push` once against the production database before first boot.
4. Deploy using the build and start commands above.
5. Verify `GET /api/healthz` returns `200`.
6. Verify `/` loads the payroll SPA.
7. Verify Google OAuth callback is configured as `https://<your-railway-domain>/api/auth/google/callback` unless you use `GOOGLE_CALLBACK_URL`.

## Notes

- The current deployment target is the payroll app only. `artifacts/mockup-sandbox` is not part of the Railway runtime.
- The backend still needs route-level auth hardening before exposing the app broadly on the public internet.
