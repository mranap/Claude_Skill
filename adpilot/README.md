# AdPilot

Multi-tenant SaaS platform for running Meta (Facebook / Instagram) advertising through the **official Meta
Marketing API (Graph API v26.0)**: connect Meta profiles, launch multi-language campaigns from templates,
monitor ad accounts, sync statistics in the background, automate budgets and statuses with safe rules, and get
notified by e-mail and Telegram — with a Super Admin panel to run the platform.

> AdPilot only uses documented Meta APIs. Proxies are a network route for a Meta profile, never a way around
> Meta's limits, reviews or policy enforcement. Rate limits are handled with queues, pacing, back-off and
> caching — not with extra tokens or proxies.

---

## Contents

1. [Features](#features)
2. [Architecture at a glance](#architecture-at-a-glance)
3. [Quick start (Docker)](#quick-start-docker)
4. [Local development](#local-development)
5. [Configuration](#configuration)
6. [Meta app, tokens and permissions](#meta-app-tokens-and-permissions)
7. [First steps after installation](#first-steps-after-installation)
8. [Operations](#operations)
9. [Testing](#testing)
10. [Security](#security)
11. [Project structure](#project-structure)
12. [Further documentation](#further-documentation)

---

## Features

**Users & access**
- E-mail + password sign-in (Argon2id), optional TOTP two-factor authentication with recovery codes.
- Users are created by administrators (invitation link or temporary password that must be changed).
- Password reset, e-mail change with confirmation, session list with remote sign-out, login history.
- Roles `USER`, `ADMIN`, `SUPER_ADMIN` plus custom roles with fine-grained permissions (RBAC).
- Strict tenant isolation: every query is scoped to the owner; foreign ids answer `404`.

**Meta integration**
- **Meta profiles**: access token (System User token recommended) + optional HTTP/HTTPS/SOCKS5 proxy and
  optional app credentials. Test token / proxy / connection before saving. Tokens are encrypted (AES-256-GCM)
  and only ever shown masked (`EAAB****7ds`). Token expiry, revocation and missing permissions are detected.
- **Discovery** of businesses, ad accounts, Pages (with Instagram accounts), pixels/datasets, custom audiences.
- **Ad account monitoring** at a user-chosen interval; notifications only on real status changes
  (e.g. Active → Disabled with the disable reason), exactly once.
- **Creative library**: image/video upload with server-side validation (format, size, duration, resolution),
  previews and thumbnails, per-user storage quota; videos are uploaded to Meta with resumable uploads.
- **Templates** with Basic and Advanced settings (objective → conversion location → optimisation goal, budget
  CBO/ABO, bidding, schedule, targeting, Advantage+ audience, placements, pixel event, identity, DSA fields,
  attribution, creative enhancements, naming).
- **Launch wizard** (9 steps): profile/account, template, campaign, ad sets, language/geo variants, creatives
  and texts, naming, **review with validation and dry run** (exact API payloads), launch.
- **Launch engine**: idempotent (double click, retries, worker restarts and lost responses never create
  duplicates), media first, campaign created paused and activated only when everything exists, verification,
  retry of failed parts, live progress.
- **Campaigns** table with filters, statuses, budgets, metrics; pause/start and budget changes; **bulk actions**
  with confirmation and safeguards; activity timeline per campaign / ad account.
- **Statistics**: background Insights sync (minimum interval 35 min, Super Admin configurable), manual refresh
  with a backend cooldown, per ad account time zone, exact money (no floating point), dashboard.
- **Automated rules** with safeguards: max change per execution, min/max budget, cooldown, max actions per
  day, no repeated action, dry run, execution history, crash-safe (intent recorded before calling Meta).

**Notifications**
- In-app notification center (always), e-mail (SMTP) and Telegram (secure deep-link linking) per
  notification type: E-mail / Telegram / Both / Off. Outbox with at-most-once delivery for ambiguous failures.

**Super Admin**
- Users, roles/permissions, settings (general, security, files, statistics, account checks, rules, Meta, SMTP
  with test e-mail, Telegram, queues, retention, maintenance, backups), audit log, system log, Meta API log,
  queue/worker monitoring, Meta rate-limit view, storage, backups, broadcasts, maintenance mode.

**Production features**
- Drafts, clone of templates/launches, dry run, activity timeline, notification center, global search
  (ad account id, campaign, ad set, ad, template), bulk actions, graceful shutdown, health checks, backups.

## Architecture at a glance

```
            ┌──────────────┐        ┌────────────────────────────────────────────────┐
 Browser ──►│ Caddy (TLS)  │──/api─►│ API (NestJS)  ── REST, auth, validation, RBAC  │
            │              │        └──────┬─────────────────────────────┬───────────┘
            │              │──/*──► Web (Next.js)                         │ jobs
            └──────────────┘               │                      ┌──────▼──────┐
                                    PostgreSQL ◄──────────────────┤ Redis/BullMQ │
                                           ▲                      └──────┬──────┘
                                           │          ┌─────────────────┴───────────────┐
                                           ├──────────┤ Worker(s): launches, uploads,   │──► Meta Graph API
                                           │          │ statistics, status, rules, mail │──► SMTP / Telegram
                                           │          └─────────────────────────────────┘──► S3 (MinIO)
                                           └────────── Scheduler (leader-elected timers)
```

- **apps/api** — NestJS 12 (TypeScript strict), Prisma 7 + PostgreSQL 17, BullMQ 5 + Redis 7. One image runs as
  **API**, **worker** (scale horizontally, optionally per queue) or **scheduler** (leader election).
- **apps/web** — Next.js 16 (App Router), React 19, Tailwind CSS 4, TanStack Query, react-hook-form + zod.
- **packages/shared** — zod schemas, permissions, Meta domain rules (objectives, placements, statuses, media
  limits), money helpers — shared by API, workers and web.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (Docker)

Requirements: a Linux VPS (2 vCPU / 4 GB RAM minimum, 4 vCPU / 8 GB recommended), Docker Engine 25+ with the
Compose plugin, a domain pointing to the server, ports 80/443 open.

```bash
git clone <repository> adpilot && cd adpilot
cp .env.example .env
# Fill in every REQUIRED value. Generate secrets:
#   openssl rand -hex 32          (passwords, JWT_ACCESS_SECRET, CSRF_SECRET, S3 secret)
#   openssl rand -base64 32       (ENCRYPTION_KEYS=k1:<value>)
docker compose up -d --build
docker compose logs -f migrate   # migrations + first Super Admin
```

Open `https://<DOMAIN>` and sign in with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`, then **remove
`SUPER_ADMIN_PASSWORD` from `.env`**. The full production guide (updates, backups, restore, scaling,
monitoring, hardening) is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Local development

Requirements: Node.js 22.12+, pnpm 10 (`corepack enable`), PostgreSQL 17, Redis 7, ffmpeg (ffprobe), and an
S3-compatible store (MinIO, or `node --experimental-strip-types apps/api/test/support/fake-s3.ts 9000` for a
local test double).

```bash
pnpm install
cp .env.example .env              # set DATABASE_URL, REDIS_URL, S3_ENDPOINT, COOKIE_SECURE=false, APP_URL=http://localhost:3000 …
pnpm build:shared
pnpm db:migrate                   # prisma migrate deploy
pnpm --filter @adpilot/api build && pnpm --filter @adpilot/api db:seed   # RBAC + Super Admin from ENV
pnpm dev:api                      # http://localhost:4000/api
pnpm dev:worker                   # background jobs
pnpm dev:scheduler                # periodic tasks
pnpm dev:web                      # http://localhost:3000 (proxies /api to :4000)
```

Without real Meta access you can run the platform against the **Meta API emulator used by the tests**:

```bash
node --experimental-strip-types apps/api/test/support/meta-emulator.ts 4010   # prints a test token and ids
# start the API/worker with META_GRAPH_BASE_URL=http://127.0.0.1:4010 META_GRAPH_VIDEO_BASE_URL=http://127.0.0.1:4010
```

Useful commands: `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`, `pnpm test:e2e`,
`pnpm admin:create -- --email you@example.com` (create/promote a Super Admin; the password is prompted).

## Configuration

All environment variables are documented in [.env.example](.env.example); they are validated at start-up
(the processes refuse to start with an invalid configuration). Everything operational — SMTP, Telegram, Meta
app, file limits, statistics intervals, rule limits, queue concurrency, retention, maintenance mode, backups —
is configured at runtime in **Super Admin → Settings** and takes effect in all processes without a restart.
Secret settings (SMTP password, bot token, app secret) are write-only and stored encrypted.

## Meta app, tokens and permissions

### Recommended setup
1. In [Meta for Developers](https://developers.facebook.com/) create a **Business** type app and add the
   **Marketing API** product. Apps need **Advanced Access** to `ads_management` / `ads_read` for accounts they do
   not own (Meta App Review); in development mode they work for ad accounts of the app's own Business.
2. In **Business Manager → Business settings → Users → System users** create a system user, assign it the ad
   accounts, Pages and pixels it should manage, and generate a **System User access token** for your app with the
   permissions below. System user tokens do not expire with a user's session (choose "never" expiry when offered).
3. In AdPilot → **Meta Profiles → Add profile**, paste the token. Optionally add a proxy and the app id/secret
   (enables `appsecret_proof` — recommended when "Require App Secret" is enabled for the app).
4. User access tokens (Graph API Explorer / Facebook Login) also work but expire (about 60 days for long-lived
   tokens); AdPilot warns 7 days before expiry.

### Permissions

| Permission | Level | Used for | If missing |
|---|---|---|---|
| `ads_management` | **Required** | Creating campaigns/ad sets/creatives/ads, uploading images and videos, pause/start, budget changes, automated rules | Launches, bulk actions and rules fail with "Requires ads_management permission"; the profile is marked *Permission revoked* |
| `ads_read` | **Required** | Reading ad accounts, statuses, campaigns, Insights statistics | Discovery, account monitoring and statistics fail |
| `business_management` | Recommended | Listing businesses and their owned/client ad accounts and Pages | Only ad accounts/Pages the token user has direct access to are discovered (a warning is shown) |
| `pages_show_list` | Recommended | Listing Pages usable as ad identity | Page pickers may be empty; enter Page access through Business Manager |
| `pages_read_engagement` | Recommended | Reading Page details and connected Instagram accounts | Instagram account selection unavailable (ads use the Page for Instagram placements) |
| `pages_manage_ads` | Optional | Ads that create/boost Page posts or use Page-owned objects | Some Page-based ad formats are rejected by Meta |
| `leads_retrieval` | Optional | Reading Instant Form lead details (not needed to count leads) | Only lead counts (from Insights) are available |
| `instagram_basic` | Optional | Instagram account details for placements | Instagram identity falls back to the Page |

AdPilot checks the granted scopes with `debug_token` / `me/permissions` whenever a token is saved and on a
schedule, and shows missing required/recommended permissions on the profile.

## First steps after installation

1. **Super Admin → Settings → SMTP**: configure and send a test e-mail (needed for invitations and resets).
2. **Super Admin → Settings → Telegram** (optional): paste the bot token from @BotFather, choose polling or
   webhook mode; users link their chat from **Settings → Notifications**.
3. **Super Admin → Settings → Meta** (optional): the platform's app id/secret; thresholds for API pacing.
4. **Super Admin → Users**: invite users (they receive a one-time link) and assign roles.
5. Users add Meta profiles, connect ad accounts, upload creatives, create templates and launch.

## Operations

- **Processes**: `api` (HTTP), `worker` (all queues; scale with `docker compose up -d --scale worker=N` or run
  dedicated workers with `WORKER_QUEUES=campaign-launch,creative-upload`), `scheduler` (one active leader).
- **Health**: `GET /api/health` (liveness), `GET /api/health/ready` (PostgreSQL + Redis). Super Admin →
  Monitoring shows queues, workers, Meta rate-limit usage, storage and recent errors.
- **Logs**: JSON on stdout (`docker compose logs`), secrets redacted; audit log, system log and Meta API log in
  the admin panel with retention settings.
- **Backups**: scheduled `pg_dump` to the backup bucket (Super Admin → Backups), restore procedure in
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#backups-and-restore). The encryption keys are **not** in backups —
  store `.env` separately.
- **Graceful shutdown**: on `SIGTERM` the API drains HTTP requests, workers finish running jobs, then
  connections close; interrupted launches resume safely.

## Testing

```bash
pnpm --filter @adpilot/api test               # unit tests
pnpm --filter @adpilot/api test:integration   # API/worker/scheduler against PostgreSQL + Redis
pnpm --filter @adpilot/api test:e2e           # the full 28-step acceptance scenario
```

Integration and end-to-end tests run the real API, worker and scheduler in-process against a dedicated
database (`<db>_test`, created and migrated automatically) and Redis database 15, with test doubles for
external systems: a **Meta Graph API emulator** (validates payloads like Meta, video processing, insights,
fault injection: throttling, lost responses, revoked tokens), S3, SMTP, the Telegram Bot API and an HTTP
CONNECT proxy. Covered: authentication, sessions, 2FA, CSRF, rate limits, RBAC and IDOR isolation, Meta
profiles and proxies, discovery, launch idempotency (double click, lost responses, ambiguity window, rate-limit
deferral, worker restart, partial failure + retry), statistics intervals and cooldowns, account status
notifications (exactly once), Telegram delivery guarantees, automated rules (safeguards, live state, dry run,
crash recovery, leases), key rotation. The web app has Playwright flows (see `apps/web`).

## Security

Argon2id passwords, TOTP 2FA, rotating refresh tokens with reuse detection, HttpOnly/SameSite cookies,
session-bound double-submit CSRF tokens + Origin checks, strict CSP, RBAC with ownership checks on every
query, AES-256-GCM encryption of all stored secrets with key rotation, SSRF protection for user-supplied
proxies, rate limiting, audit log, secret redaction in logs. See [docs/SECURITY.md](docs/SECURITY.md).

## Project structure

```
apps/api         NestJS backend: src/modules/* (feature modules), src/infra (prisma, redis, queues, crypto,
                 locks, logging), src/worker (processors), src/scheduler (tasks), src/cli (seed, admin, keys),
                 prisma/ (schema + migrations), test/ (unit, integration, e2e, test doubles)
apps/web         Next.js frontend: src/app (routes), src/features/* (per area), src/components (UI kit)
packages/shared  zod schemas, permissions, Meta rules, money helpers
deploy/          Caddyfile, MinIO bootstrap, operational scripts
docs/            architecture, Meta API, security, deployment
```

## Further documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data model, queues, launch state machine, notifications
- [docs/META_API.md](docs/META_API.md) — Graph API version, endpoints, payload rules, errors, rate limits, limitations
- [docs/SECURITY.md](docs/SECURITY.md) — security model, secrets, key rotation, review results
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production deployment, updates, backups/restore, scaling, monitoring
