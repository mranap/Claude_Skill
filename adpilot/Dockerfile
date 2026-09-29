# syntax=docker/dockerfile:1.7
#
# AdPilot images (one Dockerfile, several targets):
#   api      — REST API, background worker and scheduler (same image, different command)
#   migrate  — one-shot job: `prisma migrate deploy` + idempotent seed (RBAC, first Super Admin from ENV)
#   web      — Next.js standalone server
#
#   docker build --target api -t adpilot-api .
#   docker build --target web -t adpilot-web .

ARG NODE_IMAGE=node:22.22-bookworm-slim

# ───────────────────────────── base ─────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ───────────────────────────── dependencies (all, for building) ─────────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ───────────────────────────── build ─────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @adpilot/shared build \
 && pnpm --filter @adpilot/api exec prisma generate \
 && pnpm --filter @adpilot/api build \
 && pnpm --filter @adpilot/web build

# ───────────────────────────── production dependencies of the API ─────────────────────────────
FROM base AS api-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter "@adpilot/api..."

# ───────────────────────────── api / worker / scheduler ─────────────────────────────
FROM ${NODE_IMAGE} AS api
# ffmpeg/ffprobe: creative validation and video thumbnails. pg_dump 17 (PGDG): database backups must use a
# client at least as new as the PostgreSQL 17 server. tini: correct signal handling (graceful shutdown).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini ffmpeg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    TMP_DIR=/tmp/adpilot \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    PG_DUMP_PATH=/usr/bin/pg_dump
WORKDIR /app
COPY --from=api-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=api-deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-deps --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --chown=node:node packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
RUN mkdir -p /tmp/adpilot && chown node:node /tmp/adpilot
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# Worker: `node dist/worker.js`, scheduler: `node dist/scheduler.js` (see docker-compose.yml).
CMD ["node", "--enable-source-maps", "dist/main.js"]

# ───────────────────────────── migrate (one-shot) ─────────────────────────────
FROM build AS migrate
ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
# The Prisma CLI is a build-time dependency, so migrations run from the build stage. The seed is idempotent.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/cli/seed.js"]

# ───────────────────────────── web ─────────────────────────────
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
