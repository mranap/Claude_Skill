# @adpilot/web

Next.js frontend of AdPilot. Setup of the whole platform: [Local development](../../README.md#local-development).

```bash
pnpm dev:web                              # http://localhost:3000 (proxies /api to :4000)
pnpm --filter @adpilot/web typecheck      # app and e2e suite
pnpm --filter @adpilot/web lint
pnpm --filter @adpilot/web build
```

## End-to-end tests

Playwright specs in [`e2e/`](e2e) drive the real web app, API, worker and scheduler, with the test doubles of
`apps/api/test/support` standing in for Meta, S3 and SMTP. They run in file order with one worker:

| Spec                    | Covers                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-full-flow.spec.ts`  | Meta profile with the emulator token → discovery → connected ad accounts → image/video upload → template → launch wizard (dry run, launch until COMPLETED) → campaigns (start, bulk pause) → statistics → rule (dry run, run now, history) |
| `02-links.spec.ts`      | Invitation and password-reset e-mails: `#token=` links, POST validation, token removed from the address bar, used link refused, sign-in with the new password                                                                              |
| `03-pickers.spec.ts`    | Language, interest and Instant Form pickers in the template editor and wizard, including the manual-ID and "no ad account" fallbacks                                                                                                       |
| `04-countdowns.spec.ts` | Cooldowns that survive a reload (statistics refresh, rule "Run now") and the rate-limit labels on the monitoring page                                                                                                                      |

### 1. Start the stack

Prerequisites as in [Local development](../../README.md#local-development) (PostgreSQL, Redis, a migrated
database with a Super Admin, ffmpeg), with these values in `.env` (or in the environment of the API, worker
and scheduler):

```dotenv
APP_URL=http://localhost:3000
COOKIE_SECURE=false
S3_ENDPOINT=http://localhost:9000
META_GRAPH_BASE_URL=http://127.0.0.1:4010
META_GRAPH_VIDEO_BASE_URL=http://127.0.0.1:4010
```

Then, from the repository root, each in its own terminal:

```bash
node --experimental-strip-types apps/api/test/support/meta-emulator.ts 4010      # prints {"token": …}
node --experimental-strip-types apps/api/test/support/fake-s3.ts 9000
node --experimental-strip-types apps/api/test/support/fake-smtp.ts 2525 > /tmp/adpilot-mail.log

pnpm --filter @adpilot/api build
pnpm dev:api
pnpm dev:worker
pnpm dev:scheduler
pnpm dev:web
```

### 2. Run the suite

```bash
export E2E_ADMIN_EMAIL=admin@example.com       # a Super Admin of the dev database
export E2E_ADMIN_PASSWORD='…'
export E2E_META_TOKEN=EAAB…                    # "token" printed by the emulator (new on every start)
export E2E_MAIL_LOG=/tmp/adpilot-mail.log      # where the fake-smtp output goes
pnpm --filter @adpilot/web test:e2e            # add a file name or -g "<title>" to run a part
```

| Variable                                | Needed by  | Default / notes                                                                                               |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`                          | all        | `http://localhost:3000`                                                                                       |
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` | all        | Super Admin without 2FA                                                                                       |
| `E2E_META_TOKEN`                        | 01, 03, 04 | token of the running emulator                                                                                 |
| `E2E_MAIL_LOG`                          | 02         | file receiving the fake-smtp output                                                                           |
| `E2E_SMTP_HOST`, `E2E_SMTP_PORT`        | 02         | `127.0.0.1`, `2525`: where Super Admin → SMTP is pointed for the run                                          |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE`        | all        | a Chromium binary; otherwise Playwright's own (`pnpm --filter @adpilot/web exec playwright install chromium`) |
| `FFMPEG_PATH`                           | 01         | `ffmpeg` on the PATH; generates the uploaded image and video in a temporary directory                         |

A spec whose variables are missing is skipped with a message naming them. Failures keep a trace and a
screenshot in `e2e/test-results` (`pnpm --filter @adpilot/web exec playwright show-trace <trace.zip>`).

The suite works on the dev database: it names what it creates `E2E …` and removes it afterwards (rules,
templates, drafts, creatives, the invited user), except the launched campaign and the Meta profile
`E2E emulator …`, which the later specs reuse. Spec 01 first deletes older `E2E emulator` profiles and any
profile that holds the emulator token. Spec 02 points the SMTP settings at the catcher and restores them; it
is skipped when a stored SMTP password would be lost. The API's rate limits apply (per IP address: 20
sign-ins per minute, 10 password-reset requests per 15 minutes), so back-to-back reruns of spec 02 can hit the
second one.
