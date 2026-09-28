# Production deployment guide

This guide installs AdPilot on a single Linux VPS with Docker Compose: Caddy (automatic HTTPS), the web app,
the API, background workers, the scheduler, PostgreSQL 17, Redis 7 and MinIO (S3-compatible storage).

## 1. Requirements

|           | Minimum                                      | Recommended                                                                              |
| --------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| CPU / RAM | 2 vCPU / 4 GB                                | 4 vCPU / 8 GB (video processing, many accounts)                                          |
| Disk      | 40 GB SSD                                    | 100 GB+ SSD (creatives are stored in MinIO; plan ~2× the video library size for backups) |
| OS        | Ubuntu 22.04/24.04 LTS or Debian 12 (x86-64) |                                                                                          |
| Software  | Docker Engine 25+ with the Compose plugin    |                                                                                          |

Network: a domain (A/AAAA record → the server), inbound TCP 80/443 (and UDP 443 for HTTP/3), outbound HTTPS
to `graph.facebook.com`, `graph-video.facebook.com`, `api.telegram.org`, Let's Encrypt, and your SMTP server
(port 465/587).

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && newgrp docker
docker compose version
```

Basic hardening (recommended): SSH keys only, `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp &&
ufw enable`, unattended security upgrades (`apt install unattended-upgrades`).

## 3. Configure

```bash
git clone <repository> adpilot && cd adpilot
cp .env.example .env
chmod 600 .env
```

Fill in every value marked **REQUIRED** in `.env`:

```bash
openssl rand -hex 32      # POSTGRES_PASSWORD, REDIS_PASSWORD, MINIO_ROOT_PASSWORD, S3_SECRET_ACCESS_KEY,
                          # JWT_ACCESS_SECRET, CSRF_SECRET (one value each)
openssl rand -base64 32   # ENCRYPTION_KEYS=k1:<this value>
```

Set `DOMAIN`, `ACME_EMAIL`, `SUPER_ADMIN_EMAIL` and a strong `SUPER_ADMIN_PASSWORD` (≥ 10 characters, letters
and digits). **Store a copy of `.env` in a password manager / secrets store** — the encryption keys are needed to
read stored Meta tokens after a restore.

## 4. Start

```bash
docker compose up -d --build
docker compose ps                  # all services healthy; migrate and minio-init "exited (0)"
docker compose logs migrate        # "RBAC seeded", "Super Admin …: created"
```

Open `https://<DOMAIN>` and sign in as the Super Admin. Then:

1. remove `SUPER_ADMIN_PASSWORD` from `.env` (it is only used when no Super Admin exists);
2. enable two-factor authentication for your account (Settings → Security) and consider
   Super Admin → Security → "Require 2FA for administrators";
3. configure SMTP (send the test e-mail), optionally Telegram and the Meta app (Super Admin → Settings);
4. invite users (Super Admin → Users).

## 5. What runs

| Service                | Image           | Notes                                                                       |
| ---------------------- | --------------- | --------------------------------------------------------------------------- |
| `caddy`                | caddy:2.10      | TLS, HTTP/3, `/api` → `api:4000`, rest → `web:3000`, 4.2 GB upload limit    |
| `web`                  | adpilot-web     | Next.js standalone                                                          |
| `api`                  | adpilot-api     | `node dist/main.js`, health `GET /api/health`                               |
| `worker`               | adpilot-api     | `node dist/worker.js`, graceful stop 120 s                                  |
| `scheduler`            | adpilot-api     | `node dist/scheduler.js` (leader election)                                  |
| `migrate`              | adpilot-migrate | runs `prisma migrate deploy` + seed, then exits                             |
| `postgres`             | postgres:17     | volume `pgdata`                                                             |
| `redis`                | redis:7.4       | AOF persistence, `noeviction` (required by BullMQ), volume `redisdata`      |
| `minio` / `minio-init` | minio           | buckets (private, versioned) + least-privilege app user, volume `miniodata` |

Only Caddy publishes ports. The MinIO console (port 9001) is not exposed; reach it through an SSH tunnel if
needed (`ssh -L 9001:<minio-container-ip>:9001 server`).

## 6. Updating

```bash
git pull
docker compose build
docker compose up -d        # migrate runs first; api/worker/scheduler restart after it succeeds
docker image prune -f
```

Migrations are additive and run before the new application version starts. Workers stop gracefully: running
jobs finish (up to 120 s); interrupted launches resume from their saved state without duplicates. For
maintenance windows, enable **Super Admin → Maintenance mode** (users see a banner; administrators keep access).

## 7. Scaling

- More workers: `docker compose up -d --scale worker=3`.
- Dedicated workers per queue: create `docker-compose.override.yml`:

  ```yaml
  services:
    worker-launch:
      extends: { file: docker-compose.yml, service: worker }
      environment: { WORKER_QUEUES: 'campaign-launch,creative-upload' }
    worker:
      environment:
        {
          WORKER_QUEUES: 'meta-sync,account-status,statistics,auto-rules,bulk-actions,email,telegram,maintenance',
        }
  ```

- Concurrency per queue: Super Admin → Settings → Queues (applies after a worker restart).
- The API is stateless and can run several replicas behind Caddy (`--scale api=2` and list both upstreams, or
  use `reverse_proxy api:4000` with Docker DNS round-robin).
- External managed services: set `DATABASE_URL`/`REDIS_URL` (remove `postgres`/`redis` from compose), or use
  AWS S3 (`S3_ENDPOINT` empty, `S3_FORCE_PATH_STYLE=false`, bucket policies limited to the two buckets). Redis
  must use `maxmemory-policy noeviction` and persistence.

## 8. Backups and restore

**Database**: Super Admin → Backups → enable scheduled backups (hour, number to keep) or "Back up now". Backups
are `pg_dump` custom-format files in the backup bucket (`backups/database/…`), additionally expired after 60
days by a bucket lifecycle rule.

**Files**: creatives live in the MinIO volume/bucket (versioned). Copy them off the server regularly, e.g.
`mc mirror local/adpilot-media /mnt/offsite/adpilot-media` or bucket replication to another provider.

**Configuration**: `.env` — keep it in a secrets manager. Without `ENCRYPTION_KEYS` restored tokens cannot be
decrypted (users would have to re-enter them).

**Restore** (to the same or a new server with the same `.env`):

```bash
deploy/scripts/fetch-backup.sh                  # downloads the latest dump into ./backups/
deploy/scripts/restore-db.sh backups/<file>.dump
```

The restore stops the application services, recreates the database, restores the dump, applies newer
migrations and starts the services again. Test a restore on a staging server regularly.

## 9. Monitoring and logs

- `GET /api/health` (liveness) and `GET /api/health/ready` (PostgreSQL + Redis) — point an uptime monitor at
  `https://<DOMAIN>/api/health/ready`.
- Super Admin → Monitoring: queues (waiting/active/delayed/failed), worker heartbeats, Meta rate-limit usage per
  scope, storage usage, backups, recent failures; audit log, system log and Meta API log with filters.
- Container logs are JSON (`docker compose logs -f api worker`), rotated by Docker (20 MB × 5 per service).
  Secrets are redacted before logging.
- Resource checks: `docker stats`; PostgreSQL size `docker compose exec postgres psql -U adpilot -c "\l+"`.

## 10. Security checklist

- [ ] `.env` has mode 600, is not in git, and is backed up in a secrets manager.
- [ ] `SUPER_ADMIN_PASSWORD` removed after the first login; administrators use 2FA.
- [ ] Firewall allows only SSH, 80 and 443.
- [ ] SMTP uses TLS (465 or STARTTLS on 587).
- [ ] Meta tokens are System User tokens with only the needed assets and permissions.
- [ ] Private proxy addresses stay disallowed unless your proxies are on the internal network.
- [ ] Regular OS and image updates (`git pull && docker compose build --pull && docker compose up -d`).
- [ ] Encryption key rotation plan (see SECURITY.md).

## 11. Troubleshooting

| Symptom                                        | Check                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Caddy cannot obtain a certificate              | DNS points to the server; ports 80/443 open; `docker compose logs caddy`                                                          |
| `migrate` fails                                | `docker compose logs migrate` — usually a wrong `DATABASE_URL`/password or an invalid `.env` value (the error lists the variable) |
| Invitations/resets are not delivered           | Super Admin → Settings → SMTP → "Send test e-mail"; Monitoring → queue `email` failures                                           |
| Meta calls fail with "Proxy connection failed" | Test the profile's proxy; check credentials and that the proxy allows CONNECT to `graph.facebook.com:443`                         |
| "Meta API limit reached"                       | Normal throttling: work resumes automatically; see Monitoring → Meta rate limits                                                  |
| Statistics look stale                          | Ad account → last sync / error; minimum interval is 35 min; the manual refresh has a cooldown                                     |
| Worker jobs stuck in "delayed"                 | Deferred on purpose (video processing, rate limits, ambiguity window); the job shows the reason in its log                        |
