# Multi-stage build for the XoomAgent Control web dashboard (Next.js standalone).
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @xoom/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app/apps/web
# Next.js standalone output bundles the server + minimal node_modules.
COPY --from=build /app/apps/web/.next/standalone /app
COPY --from=build /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build /app/apps/web/public /app/apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
