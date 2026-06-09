# Deploying the dashboard to Vercel

The control platform is a pnpm monorepo. Only the **Next.js dashboard**
(`apps/web`) is deployed to Vercel. The API + Postgres are hosted separately
(see `docs/architecture.md` and the hosting options below).

## Vercel project settings (one-time)

In the Vercel project connected to this repo:

1. **Root Directory** → set to `apps/web`.
   (Settings → General → Root Directory → Edit → `apps/web`.)
2. **Include files outside the root directory** → leave **on** so the pnpm
   workspace + lockfile at the repo root are available during install.
3. **Framework Preset** → Next.js (auto-detected; `apps/web/vercel.json`
   pins it).
4. **Environment Variables** → add for Production *and* Preview:
   - `NEXT_PUBLIC_API_URL` = the public URL of your deployed control-plane API
     (e.g. `https://api.xoomagent.com`). This is baked in at build time, so it
     must be set before the build and you must redeploy if it changes.

> Until `NEXT_PUBLIC_API_URL` points at a live API, the dashboard will load but
> all data calls fail (it falls back to `http://localhost:4000`).

## API side (required for the dashboard to function)

The dashboard is a client for the API. Pick one host for the API + database:

- **Managed container (recommended, zero code change):** deploy `apps/api`
  (it has a working `Dockerfile`) to Railway / Render / Fly.io, and use
  **Neon** for Postgres. Set the API's `CORS_ORIGINS` to include your Vercel
  domain, and `DATABASE_URL` to the Neon pooled connection string.
- **Vercel serverless:** fold the Fastify API into the Vercel deployment as a
  serverless function. Fewest services, more refactoring. See architecture
  notes.

## CORS

The API must allow the Vercel origin. Set on the API:

```
CORS_ORIGINS=https://your-app.vercel.app,https://control.xoomagent.com
```
