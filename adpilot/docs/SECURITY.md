# Security model

AdPilot stores access tokens that can spend real money. The design goal: a compromise of one component
(browser session, database dump, backup, log file, one tenant's account) must not expose secrets or other
tenants' data.

## 1. Authentication

- **Passwords**: Argon2id (memory 64 MiB, 3 iterations, parallelism 1), rehashed on login when parameters
  change; minimum 10 characters with letters and digits. Constant-time dummy verification for unknown e-mails
  (no user enumeration by timing); one generic error message for unknown e-mail / wrong password.
- **Lockout & rate limits**: after N wrong passwords (default 5, configurable) from one source IP, that source is
  locked for the lockout period (default 15 min); the account itself is only locked after 5 × N failures from all
  sources together (distributed guessing), and its owner then gets a security alert. One attacker IP therefore
  cannot lock the owner out. Unknown addresses get exactly the same lock and messages as real accounts, and
  "forgot password" answers before looking the address up, so neither reveals whether an account exists. A
  password reset (proof of mailbox control) lifts every lock of the account. Per-IP limits for login, password
  reset and the 2FA endpoints; all counters are shared by the API replicas (Redis) and use hashed identifiers.
- **Two-factor authentication**: TOTP (RFC 6238, SHA-1, 30 s, ±1 step), secret stored encrypted, 10 one-time
  recovery codes stored as hashes, single-use MFA ticket (Redis) between the password and the code step. Wrong
  codes are counted per user across sign-in and the 2FA settings endpoints: 10 within 15 minutes lock the
  second factor and the account and alert the owner, so knowing the password does not allow guessing codes by
  requesting fresh tickets; failure counters are only reset once the whole sign-in succeeded. Super Admin can
  require 2FA for administrators.
- **Sessions**: short-lived JWT access token (15 min, `HttpOnly`, `SameSite=Lax`, `__Host-` prefix, `Secure`) +
  opaque rotating refresh token (`HttpOnly`, `SameSite=Strict`, path `/api/auth`) stored as a SHA-256 hash.
  Refresh rotation with a 60 s grace for parallel tabs; reuse of an old refresh token after the grace window
  revokes the session (token theft detection). Idle and absolute session lifetimes are configurable; sessions
  are listed and can be revoked by the user or an administrator; password change/reset, a confirmed e-mail
  change (all sessions), turning 2FA off (other sessions) and blocking revoke sessions immediately (a revoked
  session fails on the next request, not after the access token expires).
- **One-time tokens** (password reset, invitation, e-mail change: 256-bit; Telegram link: 192-bit, 10 minutes):
  only their hashes are stored, single use (atomic compare-and-set), short expiry. E-mail links carry them in
  the URL fragment (`#token=`), which browsers never send to a server or in a `Referer`; validation is a POST.
  Changing the password, the e-mail address or turning 2FA off (and administrator resets) invalidates every
  outstanding reset, invitation and e-mail-change link, so a link requested with a stolen password dies with it.
  Caddy's access log additionally redacts `token` query parameters and drops `Referer` headers.
- **Forced password change** for temporary passwords set by an administrator: only the password-change endpoint
  and sign-out work until it is changed.

## 2. Authorization and tenant isolation

- RBAC: permissions (`app.*`, `admin.*`) grouped in roles; `SUPER_ADMIN` has all permissions. Administrators
  cannot assign roles above their own, cannot modify Super Admins, and the last Super Admin cannot be removed.
  Role management is no path to more power: only a Super Admin grants `admin.*` permissions or edits a role that
  has them (never one's own role). Administrators cannot reset their own password or 2FA through the admin API
  (the self-service endpoints ask for the current password and code).
- Every product route checks its `app.*` permission; read access shared by several features (e.g. the launch
  wizard reading templates and creatives) requires any one of the matching permissions, and global search only
  covers the areas the role can read.
- Every tenant-owned query filters by `userId` (ownership helpers such as `findOwned()`); foreign ids return
  `404` (existence is not revealed). References inside payloads (profile, ad account, template, draft, creative,
  pixel, page, audience, campaign ids) are verified to belong to the user before use.
- Workers re-check ownership (job payloads carry the user id and are validated against the row).
- Integration tests cover IDOR attempts on every resource type.

## 3. CSRF, XSS and HTTP hardening

- CSRF: `SameSite` cookies + Origin/Referer allow-list + double-submit token (`X-CSRF-Token`) bound to the
  session with an HMAC; pre-login tokens are only accepted by public auth endpoints.
- XSS: React escapes output; the web app sends a strict Content-Security-Policy (`default-src 'self'`, no
  external scripts, `frame-ancestors 'none'`); the API answers JSON only with `default-src 'none'`. E-mail
  templates and Telegram messages escape all user-provided values. Uploaded files are served with their
  verified content type and `Content-Disposition`, never as HTML/SVG.
- Helmet headers, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, HSTS in production, no
  `X-Powered-By`, body size limits, request timeouts. `TRUST_PROXY` defaults to 0 (docker-compose sets 1 for
  Caddy, which overwrites `X-Forwarded-For`), so clients cannot fake their IP to evade per-IP limits.

## 4. Secrets

- **Encryption at rest**: Meta access tokens, app secrets, proxy passwords, 2FA secrets, SMTP password, Telegram
  bot token and webhook secret are encrypted with **AES-256-GCM** (random 96-bit IV per value, 128-bit tag,
  truncated tags rejected). Each value is bound to its location with additional authenticated data
  (`meta_profile:<id>:token`, …), so ciphertext copied to another row does not decrypt.
- **Keys** live only in the environment (`ENCRYPTION_KEYS`), never in the database or its backups. A key ring
  allows rotation: add a key, make it active, restart, run `node dist/cli/rotate-keys.js` (re-encrypts every
  secret with compare-and-set, safe while running), remove the old key.
- **Never returned**: tokens are shown masked (`EAAB****7ds`); secret settings are write-only (`passwordSet:
true`); an empty input keeps a secret, only an explicit clear removes it. The SMTP password is only kept while
  host, port, encryption and user name stay the same (SMTP AUTH would otherwise send it to a new server).
  Settings are updated read-merge-write under a row lock, so concurrent edits never revert each other.
- **Never logged**: structured logs pass through a sanitizer (tokens, `access_token=`, Bearer values, URL
  credentials, secret-looking keys) and pino redaction; the Meta API log stores paths without tokens; job payloads
  do not contain secrets (connections are built in the worker from encrypted rows); e-mails with one-time links
  are sealed (AES-GCM) while queued, and the admin queue viewer shows message bodies only as their size.
- Decrypted secrets exist only in memory for the duration of a request or job.

## 5. Network

- Meta profile proxies (HTTP/HTTPS/SOCKS5 with remote DNS) are only a network route for that profile's Meta
  calls. **SSRF protection**: proxy hosts must resolve to public addresses (loopback, private, link-local incl.
  cloud metadata, CGNAT, multicast and reserved ranges are refused). The check runs when saving/testing and,
  binding, inside the socket's DNS lookup on every connection, so a DNS answer that changes after the check
  (DNS rebinding) cannot reach internal services. Error messages never contain resolved addresses (no internal
  DNS oracle); SMTP test errors are shown without IP addresses. A Super Admin can allow private proxies for
  company-internal proxy servers.
- The server never fetches arbitrary user-supplied URLs.
- Only Caddy is exposed; PostgreSQL, Redis (password, `noeviction`), MinIO (least-privilege app user) and the
  services are on the internal Docker network. Each container receives only the variables it reads: the MinIO
  root password and the initial Super Admin password never reach the application processes.

## 6. Files

Uploads are streamed (busboy) with per-file and per-request limits and per-user storage quotas. Nothing is
written beyond the remaining quota: a declared `Content-Length` over it is refused up front, and while streaming
a file that exceeds it is cut off. A client that disconnects mid-upload ends the request and its temporary file
is deleted; at most 3 uploads per user run at the same time, and stale temporary files are swept hourly. The
type is detected from the content (ffprobe/sharp), not from the name or declared MIME type; images are
re-encoded for previews; videos are probed for duration, resolution and codecs; storage keys are generated
server-side (no user-controlled paths).

## 7. Auditing and monitoring

- Audit log (append-only: database triggers block every UPDATE, and every DELETE except the retention job's,
  which runs in a transaction marked with a transaction-local setting) for sign-ins, security changes, admin
  actions, profile/token changes, launches, budget/status changes, rule actions, settings changes.
- System log for worker/scheduler failures; Meta API log with error codes and `fbtrace_id`; login history per
  user; retention periods configurable.

## 8. Backups

`pg_dump` custom-format backups to a separate bucket. Backups contain encrypted secrets but **not** the keys —
keep `.env` (or at least `ENCRYPTION_KEYS`) in a separate secrets store, otherwise a restore cannot decrypt
tokens. Backups can be restored into an empty database with `pg_restore` (see DEPLOYMENT.md).

## 9. Review

After the implementation, the complete backend was reviewed in three independent passes. Each finding was
traced to the code with a concrete failure scenario, re-checked before fixing, and fixed with a regression test
where feasible (`apps/api/test`). No critical findings.

| Review                         | Scope                                                                                              | High | Medium | Low | Outcome                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ---- | ------ | --- | ------------------------- |
| Security                       | auth, sessions, CSRF, RBAC, IDOR, SQL injection, XSS, secrets, encryption, SSRF, files, deployment | 1    | 5      | 7   | all fixed                 |
| Concurrency & reliability      | races, duplicates, retries, loops, leaks, deadlocks, scheduler, time zones, shutdown               | 2    | 7      | 13  | all fixed                 |
| Meta API, money, notifications | Graph v26 fields and combinations, error codes, rate limits, budget math, rules, duplicate alerts  | 3    | 7      | 12  | all fixed but one (below) |

Highlights of what changed:

- **Security**: one-time links sealed while queued (an administrator could read them in the queue viewer);
  per-source and per-user brute-force locks for passwords and 2FA codes; no privilege escalation through role
  management or admin self-reset; proxy address policy enforced at connect time (DNS rebinding); aborted uploads
  no longer leak disk space; tokens out of URLs and logs; SMTP password bound to its server; least-privilege
  container environment; nonce-based CSP in the web app.
- **Concurrency**: Meta sync retries no longer swallowed; status writes fenced by the token they were made with;
  alerts written in the same transaction as the state change; launches, rules and schedulers hold renewed,
  per-run leases; bounded waits for launches; recovery of stuck bulk actions, backups and deliveries; streaming
  Insights storage.
- **Meta and money**: budget rules can no longer move a budget the wrong way; hourly rules refuse metrics Meta
  does not report by hour; an object-level permission error no longer suspends a whole profile; Business Use
  Case limits enforced and never shortened; complete launch budget minimums (lifetime, 5× billing, bid caps,
  campaign budget over all ad sets, spend cap); Instant Form creatives carry Meta's placeholder link; 28-day
  Insights refresh for late conversions.

Not changed: error code 341 stays a validation error — it appears neither in Meta's error reference nor in the
Business SDK v26, so it could not be verified as a rate limit.

## 10. Reporting a vulnerability

Please report security issues privately to the platform operator (see Super Admin → Settings → General →
support e-mail) instead of opening a public issue.
