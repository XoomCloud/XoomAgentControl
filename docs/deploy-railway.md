# Deploying the control-plane API to Railway

The API (`apps/api`) deploys from its existing `Dockerfile`. Railway also
provides the PostgreSQL database, so the managed footprint is just:

```
Vercel (apps/web)  ─►  Railway (API container + Railway Postgres)
        ▲                          ▲
        └──────── operator         │ outbound HTTPS only
                                    │
                        Hetzner KVM hosts (host agent)
```

> Validated locally: the image builds with pinned `pnpm@10.33.0`, runs its
> boot-time `db push` + `db seed`, serves `/health`, and authenticates the
> seeded admin. The only build requirement was pinning pnpm (done in the
> Dockerfile) so "ignored build script" handling is deterministic.

## Steps

1. **Create a Railway project** and add a **PostgreSQL** plugin (gives you
   `DATABASE_URL`).
2. **Add a service from this GitHub repo.** Railway reads `railway.toml` at the
   repo root, which points the build at `apps/api/Dockerfile` (build context =
   repo root, as the Dockerfile expects).
3. **Set service variables** (Railway → service → Variables):
   - `DATABASE_URL` → reference the Postgres plugin's variable
     (`${{Postgres.DATABASE_URL}}`).
   - `JWT_SECRET` → a 32+ char random string.
   - `HOST_REGISTRATION_TOKEN` → bootstrap token your host agents present.
   - `SECRETS_MASTER_KEY` → `openssl rand -base64 32` (or point
     `SECRETS_PROVIDER` at Infisical/Doppler for production — see below).
   - `API_PUBLIC_URL` → the Railway public URL of this service
     (e.g. `https://xoom-api.up.railway.app`).
   - `CORS_ORIGINS` → your Vercel dashboard URL
     (e.g. `https://your-app.vercel.app`).
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` → first admin login.
   - `LITELLM_BASE_URL`, `LITELLM_ADMIN_KEY`, `SUPERMEMORY_*` → when ready.
   - `PORT` is injected by Railway automatically; the API honours it.
4. **Deploy.** On boot the container runs `db push` + `db seed` (idempotent),
   then starts the API. The healthcheck hits `/health`.
5. **Point the dashboard at it:** in Vercel set
   `NEXT_PUBLIC_API_URL = https://<your-railway-api-url>` and redeploy
   (it's baked in at build time).

## Host agents

On each Hetzner host, set the agent's `CONTROL_PLANE_URL` to the Railway API
URL and `HOST_REGISTRATION_TOKEN` to the same bootstrap token. Agents connect
**outbound** only — no inbound ports on the hosts, no Railway→host path.

## Production hardening notes

- **Secrets:** for production, set `SECRETS_PROVIDER=infisical` (or `doppler` /
  `vault` / `aws`) instead of the local AES master key, so the key that can
  touch every tenant isn't sitting in a plain env var. The provider abstraction
  already exists in `apps/api/src/lib/secrets.ts`.
- **Migrations:** the boot command uses `prisma db push` for MVP simplicity.
  For change-controlled deploys switch to `prisma migrate deploy` with checked-in
  migrations.
- **Database:** swap Railway Postgres for **Neon** later by changing only
  `DATABASE_URL` (use Neon's pooled connection string for serverless workloads).
