# Multi-stage build for the XoomAgent Control API.
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Pin pnpm so build behaviour is deterministic across dev and deploy.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/auth/package.json packages/auth/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile=false
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @xoom/db generate \
  && pnpm --filter @xoom/shared-types build \
  && pnpm --filter @xoom/auth build \
  && pnpm --filter @xoom/db build \
  && pnpm --filter @xoom/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 4000
# Apply schema + seed on boot, then start. (For real deploys use migrate deploy.)
CMD ["sh", "-c", "pnpm --filter @xoom/db push && pnpm --filter @xoom/db seed; node dist/index.js"]
