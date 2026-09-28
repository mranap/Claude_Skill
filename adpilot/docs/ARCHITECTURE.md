# Architecture

This document describes how AdPilot is built and why. It covers the processes, the data model, the backend
modules, background jobs, the campaign launch engine, statistics, automated rules and notifications.

## 1. Processes

| Process | Command | Scales | Responsibility |
|---|---|---|---|
| **API** | `node dist/main.js` | horizontally (stateless) | REST API under `/api`: authentication, validation (zod), RBAC, ownership checks, enqueueing jobs. Never calls Meta for long operations. |
| **Worker** | `node dist/worker.js` | horizontally; per queue with `WORKER_QUEUES` | Consumes BullMQ queues: Meta sync, account status, statistics, launches, creative uploads, rules, bulk actions, e-mail, Telegram, maintenance. |
| **Scheduler** | `node dist/scheduler.js` | 1 active (Redis leader lock; more replicas = standby) | Periodic tasks that *claim* due work in PostgreSQL and enqueue jobs; Telegram long polling. |
| **Web** | `node apps/web/server.js` | horizontally | Next.js App Router UI (client-side data fetching against `/api`). |
| **Caddy** | — | — | TLS termination, `/api` → API, everything else → web, upload size limits. |

State lives only in **PostgreSQL** (source of truth), **Redis** (queues, locks, rate-limit state, caches,
pub/sub for settings invalidation) and **S3** (creative files, previews, database backups).

### Request pipeline (API)

`request-context middleware` (request id, access log) → helmet (CSP `default-src 'none'`) → cookie parser →
body limits → global guards in this order:

1. **AuthGuard** — access JWT cookie (15 min) → user from a 60 s Redis cache (session revocation is immediate:
   the session id is checked); `@Public()` routes pass; users with `mustChangePassword` may only reach
   `@AllowPendingPasswordChange()` routes.
2. **RateLimitGuard** — `@RateLimit()` buckets per user or IP (Redis fixed windows, shared by all replicas).
3. **MaintenanceGuard** — only administrators (and public/auth routes) while maintenance mode is on.
4. **CsrfGuard** — Origin/Referer allow-list + double-submit token bound to the session.
5. **PermissionsGuard** — `@RequirePermissions()` against the role's permissions.

Errors are converted by one exception filter into `{ error: { code, message, details?, meta?,
retryAfterSeconds? }, requestId }` (Meta errors carry friendly text plus code/subcode/fbtrace_id).

## 2. Data model (PostgreSQL, Prisma)

| Area | Tables |
|---|---|
| Identity & access | `users`, `roles`, `permissions`, `role_permissions`, `sessions`, `password_reset_tokens` (reset + invite), `email_change_tokens`, `login_events` |
| Notifications | `notification_preferences`, `notifications` (in-app center), `notification_deliveries` (outbox per channel), `telegram_connections`, `telegram_link_codes`, `broadcasts` |
| Meta | `proxies`, `meta_profiles` (encrypted token), `business_accounts`, `ad_accounts`, `account_status_history`, `pages`, `pixels`, `custom_audiences` |
| Creatives | `creative_files` (library), `creative_meta_assets` (per ad account: image hash / video id / thumbnail) |
| Launching | `campaign_templates`, `launch_drafts`, `launch_jobs` (unique `userId + idempotencyKey`, unique `code`), `launch_job_items` (one row per Meta object, unique `launchJobId + key`) |
| Mirror & stats | `campaigns`, `ad_sets`, `ads` (local mirror of Meta objects), `insights_daily` (unique `adAccountId + level + metaObjectId + date`) |
| Automation | `auto_rules`, `auto_rule_executions`, `bulk_operations` |
| Operations | `activity_events` (timelines), `audit_logs` (append-only: UPDATE/DELETE blocked by a trigger), `meta_api_logs`, `system_logs`, `system_settings`, `backups` |

Conventions: UUID primary keys; every tenant-owned row has `userId` and every query filters on it; money in
**minor units** (`BigInt`) for budgets and `Decimal` for reported spend — never floating point; timestamps in
UTC with the ad account time zone stored separately; secrets only as encryption envelopes
(`enc1:<keyId>:<iv>:<tag>:<ciphertext>`, see SECURITY.md). Migrations in `apps/api/prisma/migrations` include
raw SQL for the audit-log trigger and CHECK constraints (lower-case e-mails, non-negative amounts).

## 3. Backend modules (`apps/api/src/modules`)

| Module | Responsibility |
|---|---|
| `auth` | login, 2FA, sessions/refresh rotation, CSRF, password reset/invite, e-mail change, account settings |
| `admin` | users, roles, settings, logs, monitoring (queues/workers/rate limits/storage), broadcasts, backups |
| `settings` | typed settings with defaults (zod), encrypted secret fields, cross-process cache invalidation |
| `meta` | Graph client, error classification, rate-limit manager, usage headers, proxy agents, token inspection, asset discovery, profile status |
| `meta-profiles`, `ad-accounts` | profiles (token, proxy, app credentials), connect accounts, status checks and history |
| `creatives`, `storage` | upload pipeline (busboy streaming, ffprobe/sharp validation, thumbnails), S3, Meta media upload |
| `templates`, `launches` | templates, drafts, validation, dry run, plan builder, payload builders, launch executor |
| `campaigns` | mirror sync, campaign/ad set/ad views, status and budget actions, bulk operations |
| `statistics`, `dashboard`, `search` | Insights sync, aggregation, dashboard cards, global search |
| `rules` | rule CRUD, metrics, engine with safeguards |
| `notifications`, `mail`, `telegram` | outbox, preferences, templates, SMTP, Telegram bot (linking, webhook/polling) |
| `audit`, `activity`, `system-log`, `maintenance` | audit trail, timelines, system log, retention and backups |

## 4. Queues and background work

| Queue | Jobs | Notes |
|---|---|---|
| `meta-sync` | `META_SYNC` (discovery), `TOKEN_CHECK` | syncs per profile are serialised (lock) and coalesced |
| `account-status` | `ACCOUNT_STATUS_CHECK` (≤ 50 accounts per request) | compare-and-set status change + history + one notification |
| `statistics` | `STATISTICS_SYNC` | entity mirror (hourly) + daily Insights for a rolling window |
| `campaign-launch` | `CAMPAIGN_CREATE` | the launch state machine (section 5) |
| `creative-upload` | `CREATIVE_UPLOAD` | pre-upload of media to an ad account |
| `auto-rules` | `AUTO_RULE_CHECK` | one rule evaluation (lease per rule) |
| `bulk-actions` | `BULK_ACTION` | pause/start many objects with progress |
| `email`, `telegram` | `EMAIL_SEND`, `TELEGRAM_SEND` | notification deliveries (outbox) and system e-mails |
| `maintenance` | `RETENTION_CLEANUP`, `DATABASE_BACKUP`, `BROADCAST` | |

Conventions (`src/worker`): retries with exponential back-off + jitter (30 s … 30 min); non-retryable errors
(validation, permission, auth) fail immediately (`UnrecoverableError`); waiting for Meta (rate limits, video
processing, ambiguity windows) **defers** the job (`moveToDelayed`) without consuming attempts or blocking a
worker slot. Concurrency per queue is a Super Admin setting.

### Scheduler tasks

| Task | Every | Claims |
|---|---|---|
| `statistics-sync` | 1 min | accounts with `nextStatsSyncAt <= now`; next run = now + max(account interval, global minimum 35 min) |
| `ad-account-status-check` | 1 min | accounts due for a status check (user-chosen interval) |
| `meta-token-check` / `meta-asset-sync` | 5 / 10 min | profiles due for token validation / discovery |
| `auto-rules` | 1 min | active rules with `nextRunAt <= now` |
| `launch-recovery` | 5 min | unfinished launches without a queued job (e.g. Redis lost) |
| `notification-outbox-sweep` | 1 min | deliveries that were never enqueued or stuck |
| `retention-cleanup`, `database-backup` | 10 min | daily retention, scheduled backups |

Claiming is a single `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`, which moves the next
due time forward in the same statement — two schedulers can never enqueue the same work.

### Graceful shutdown

1. Consumers stop (workers finish running jobs, scheduler releases leadership) — `onModuleDestroy`;
2. buffers flush and queues close — `beforeApplicationShutdown`;
3. Redis and PostgreSQL disconnect — `onApplicationShutdown`.
The API first stops accepting connections and drains in-flight requests (`installGracefulShutdown`).

## 5. Campaign launch engine

`POST /api/launches` validates the configuration (the same validator as "Validate" and "Dry run"), builds a
**plan** (one item per Meta object: media → campaign → ad sets → creatives → ads, with references between
them) and stores the job and all items in one transaction, keyed by the client's idempotency key.

```
QUEUED → VALIDATING → UPLOADING_CREATIVES → CREATING_CAMPAIGN → CREATING_ADSETS → CREATING_ADS
       → VERIFYING → ACTIVATING → COMPLETED | PARTIAL_FAILURE | FAILED | CANCELLED
```

Duplicate prevention, from the outside in:
- one launch per `(user, idempotencyKey)` (unique index) — double clicks, network retries, two tabs;
- one BullMQ job id per launch round; a database **lease** so only one worker executes a launch;
- each item is marked `IN_FLIGHT` (committed) *before* the create request and `CREATED` with the Meta id after;
- after a crash/timeout the next attempt **reconciles** an `IN_FLIGHT` item by looking the object up in Meta by
  its unique name (names carry the launch code) under its parent; it is re-created only when it provably does
  not exist and the original request can no longer be processed (ambiguity window);
- `VERIFYING` re-reads the campaign tree; untracked duplicates with this launch's code are deleted (they never
  delivered: the campaign is still paused);
- the campaign is created **PAUSED**; ad sets/ads are created active under it; `ACTIVATING` flips the campaign
  only when every object exists and the user asked for activation;
- rate limits defer the job until the scope recovers; failed items can be retried (`/retry`) without touching
  created ones.

Media: images go to `/act_{id}/adimages`; videos use the resumable upload protocol on `graph-video` (start →
transfer chunks → finish), then the job defers until `status.video_status = ready` and a thumbnail exists.

## 6. Statistics

`STATISTICS_SYNC` for one ad account: refresh the entity mirror when due, then fetch daily Insights
(`time_increment=1`) per level (account, campaign, ad set, ad) for a rolling window in the **ad account time
zone** (3 days by default; 30 days on the first sync) and upsert into `insights_daily`. Recent days are re-read
because Meta keeps attributing late conversions. Requests that return "too much data" are split by date range.
Money stays decimal; leads/purchases are de-duplicated across action types; "Results" uses Meta's `results`
field. Manual refresh is allowed once per cooldown (backend compare-and-set).

## 7. Automated rules

Every minute the scheduler claims due rules; `AUTO_RULE_CHECK` evaluates one rule under a lease:
candidates from the mirror → fresh metrics from Insights for the rule's time range → all conditions (AND) →
safeguards (cooldown per object, max actions per 24 h, same action not repeated, min/max budget, max change per
execution, account minimum budget) → **live state read from Meta** → a `PENDING` execution row → the Meta call →
`SUCCESS`/`FAILED`. A `PENDING` row left by a crash is verified against Meta before anything else happens for
that object. Dry-run rules record `DRY_RUN` rows only. One summary notification per run.

## 8. Notifications

`notify()` stores the notification (in-app center) and one **delivery** row per channel allowed by the user's
preference for that type (Email / Telegram / Both / Off) in one transaction, deduplicated by
`(userId, dedupeKey)`; then enqueues each delivery. Delivery states: `PENDING → SENDING → SENT | FAILED |
SKIPPED | UNCERTAIN`. A send whose outcome is unknown (timeout after the request was sent) becomes
`UNCERTAIN` and is **not** retried — a message is never sent twice. Telegram rate limits (429) honour
`retry_after`; a chat that blocked the bot deactivates the link. The outbox sweep re-enqueues deliveries whose
job was lost.

Telegram linking: the user gets a one-time deep link `t.me/<bot>?start=<code>` (10 minutes, only the hash is
stored); the chat that sends `/start <code>` becomes the notification chat.

## 9. Frontend

Next.js App Router with route groups `(auth)` and `(app)`; data via TanStack Query against `/api` with a client
that attaches the CSRF token, refreshes the session once for concurrent 401s and maps API errors (including Meta
details) to readable messages. Areas: dashboard, Meta profiles, ad accounts, creatives, templates, launch wizard
and launches, campaigns, statistics, rules, notifications, settings, admin (users, roles, settings, monitoring,
logs, broadcasts). Forms reuse the shared zod schemas, so client and server validation agree.
