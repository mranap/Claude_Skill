# Meta Marketing API integration

AdPilot talks to Meta only through the documented **Graph API / Marketing API**, version **v26.0**
(`META_GRAPH_API_VERSION`). Every request goes through one client (`apps/api/src/modules/meta/graph/
meta-graph.client.ts`) that adds authentication, the profile's proxy, pacing, logging and error classification.

Rules verified against Meta's documentation and the official Business SDK v26.0.2 (September 2026) are marked
✔. Where a requirement conflicted with the current API, the supported alternative is implemented and the
limitation is listed in [section 9](#9-limitations-and-supported-alternatives).

## 1. Integration map

| Purpose | Endpoint(s) | Permission |
|---|---|---|
| Token inspection | `GET /me`, `GET /me/permissions`, `GET /debug_token?input_token=<the token>` (called with the token itself) | any |
| Businesses | `GET /me/businesses` | `business_management` |
| Ad accounts | `GET /me/adaccounts`, `GET /{business}/owned_ad_accounts`, `GET /{business}/client_ad_accounts`, batched `GET /?ids=act_…` | `ads_read` |
| Pages / Instagram | `GET /me/accounts`, `GET /{business}/owned_pages`, `client_pages`, `GET /act_{id}/promote_pages` | `pages_show_list`, `pages_read_engagement` |
| Pixels / datasets | `GET /act_{id}/adspixels` | `ads_read` |
| Custom audiences | `GET /act_{id}/customaudiences` | `ads_read` |
| Account status | `GET /?ids=act_…&fields=account_status,disable_reason,…` (50 per call) | `ads_read` |
| Images | `POST /act_{id}/adimages` | `ads_management` |
| Videos | `POST graph-video…/act_{id}/advideos` (`upload_phase=start/transfer/finish`), `GET /{video}?fields=status`, `GET /{video}/thumbnails` | `ads_management` |
| Create | `POST /act_{id}/campaigns`, `/adsets`, `/adcreatives`, `/ads` | `ads_management` |
| Read tree | `GET /act_{id}/campaigns|adsets|ads`, `GET /{campaign}/adsets|ads`, `GET /{object}` | `ads_read` |
| Update | `POST /{object}` with `status` or `daily_budget` / `lifetime_budget` | `ads_management` |
| Insights | `GET /act_{id}/insights` (`level`, `time_range`, `time_increment`, `filtering`) | `ads_read` |

Authentication: `access_token` in the query/body; `appsecret_proof` (HMAC-SHA256 of the token with the app
secret) is added when the secret of **the app that issued the token** is known (checked via `debug_token`).

## 2. Campaign creation rules

Campaign (`POST /act_{id}/campaigns`) ✔
- `objective` (ODAX): `OUTCOME_LEADS`, `OUTCOME_SALES`, `OUTCOME_TRAFFIC`, `OUTCOME_AWARENESS`, `OUTCOME_ENGAGEMENT`.
- `special_ad_categories` always sent (`[]` when none); with a category, `special_ad_category_country` is required.
  Values: `EMPLOYMENT`, `HOUSING`, `FINANCIAL_PRODUCTS_SERVICES` (replaced `CREDIT`), `ISSUES_ELECTIONS_POLITICS`,
  `ONLINE_GAMBLING_AND_GAMING`.
- Campaign budget (Advantage campaign budget): `daily_budget`/`lifetime_budget` + `bid_strategy` on the campaign.
  Ad set budgets: `is_adset_budget_sharing_enabled` must be sent explicitly (since v24).
- Created with `status=PAUSED`; activated at the end of a successful launch. If Meta refuses the activation
  (validation/policy), the launch completes with a warning: every object exists and can be started later.
- Budget minimums checked before anything is created ("Bid/Budget Validations"): the account's
  `min_daily_budget`; 5× that for `LINK_CLICKS`/`THRUPLAY` billing without a bid cap; with a bid cap at least the
  bid (5× the bid when billing on clicks or actions); lifetime budgets need the daily minimum over the scheduled
  duration; a campaign budget must cover every ad set's minimum (error 2238055); a campaign spend cap must reach
  the account's `min_campaign_group_spend_cap` (error 2446307).

Ad set (`POST /act_{id}/adsets`) ✔
- `optimization_goal`, `billing_event`, `destination_type`, `promoted_object` (`pixel_id` + `custom_event_type` for
  website conversions/value; `page_id` for lead forms and awareness goals), budget for ABO, `bid_amount` for
  cost cap / bid cap, `bid_constraints.roas_average_floor` = ROAS × 10 000 (0.01–1000) for minimum ROAS (value
  optimisation only), `start_time`/`end_time` (end required for lifetime budgets).
- `targeting`: `geo_locations.countries`, `excluded_geo_locations`, `age_min`/`age_max`, `genders`, `locales`,
  `custom_audiences`/`excluded_custom_audiences`, `flexible_spec` interests, placements (manual only), and
  **always** `targeting_automation.advantage_audience` (0/1) — required for constrained setups since v23 and for
  housing/employment/financial ad sets since v26.
- Advantage+ audience = 1: `age_min` only 18–25, `age_max` fixed at 65; gender, interests and custom audiences are
  suggestions; locations, languages, minimum age and excluded audiences stay strict.
- Special ad categories (housing, employment, financial): ages 18–65+, all genders, no location exclusions.
  Political ads cannot be delivered in the EU.
- `attribution_spec` only for conversion goals in CUSTOM mode: click-through 1 or 7 days, view-through 1 day,
  engaged-view ("engage-through") 1 day. 7/28-day view windows no longer exist.
- EU targeting (Digital Services Act): `dsa_beneficiary` and `dsa_payor` are required; defaults come from the ad
  account's `default_dsa_beneficiary/payor`.
- Placements (manual): `publisher_platforms` facebook / instagram / audience_network / threads; positions per
  platform; `device_platforms`. Removed by Meta and not offered: all Messenger placements (`messenger_home`
  since 2025-11-11, `sponsored_messages` since v20, Messenger Stories in v26), Facebook `video_feeds` (v24),
  Instagram `explore` (v26; `explore_home` remains). Combination rules enforced: Audience Network not alone;
  Threads requires the Instagram feed; Facebook Stories require Facebook Feed or Instagram Stories on mobile;
  Marketplace/Search/Profile feed require Facebook Feed; Instagram cannot be desktop-only.

Creative (`POST /act_{id}/adcreatives`) ✔
- `object_story_spec` with `page_id` (+ `instagram_user_id`), and `video_data` (`video_id`, `image_url`
  thumbnail — required by Meta, taken from `/{video}/thumbnails`), `link_data` (`image_hash`) or carousel
  `link_data.child_attachments` (video cards need `picture` or `image_hash`).
- `call_to_action` with the link, or `lead_gen_form_id` for Instant Forms; as in Meta's Lead Ads guide, Instant
  Form creatives send the placeholder link `http://fb.me/` in `link_data`, carousel cards and the video
  call-to-action value. Destinations that need a website link are validated with `destinationNeedsLink`.
- `url_tags` for UTM parameters; `contextual_multi_ads.enroll_status` OPT_IN/OPT_OUT.
- "No automatic enhancements": `degrees_of_freedom_spec.creative_features_spec` with each feature
  `enroll_status: OPT_OUT` (feature keys verified against `AdCreativeFeaturesSpec` in SDK v26, including
  `image_background_gen`, `creative_stickers`, `reveal_details_over_time` and `text_translation`). Features Meta
  documents as opt-in only (e.g. `text_generation`) are simply not requested; music is avoided by sending no
  `asset_feed_spec.audios`.

Ad (`POST /act_{id}/ads`): `name`, `adset_id`, `creative.creative_id`, `status`.

Names carry the launch code (`{name} | {date} | #{code}` by default) so objects can be reconciled after an
interrupted request (see ARCHITECTURE.md → launch engine).

## 3. Media

- Images: validated locally (JPG/PNG, ≤ 30 MB, ≥ 600×600), uploaded as a multipart file to `/adimages`; the
  returned `hash` is stored per ad account and reused by every launch in that account.
- Videos: MP4/MOV, ≤ 4 GB, 1 s – 241 min; resumable upload on `graph-video.facebook.com`: `start` (file size) →
  `transfer` chunks at the offsets Meta returns (on error subcode 1363037 the upload resumes at Meta's offset) →
  `finish`. Processing is polled via `status.video_status` (`processing` → `ready` / `error`); the launch waits
  without blocking a worker. Videos narrower than 600 px produce a warning (Instagram thumbnail minimum).

## 4. Insights

- Daily rows (`time_increment=1`) per level with `time_range` in the ad account time zone; fields:
  `spend, impressions, reach, clicks, inline_link_clicks, actions, action_values, video_thruplay_watched_actions,
  results` + ids/names, `objective`, `optimization_goal`.
- Leads = `lead` (aggregated) or `onsite_conversion.lead_grouped` + `offsite_conversion.fb_pixel_lead`;
  purchases/value = `omni_purchase` → `purchase` → `offsite_conversion.fb_pixel_purchase` (never summed).
- "Results" = Meta's `results` field (the outcome of the ad set's goal and conversion event), ThruPlays from
  `video_thruplay_watched_actions`.
- Too much data (`100/1487534`, `100/1504018`, `2/1504038`, "reduce the amount of data") → the date range is split.
- Reach (unique people) is not additive across days or objects: it is shown for single-day ranges and hidden
  (null) for longer ranges instead of showing a misleading sum.
- Since 2025-06-10 Meta applies the ad set attribution settings to Insights (`use_unified_attribution_setting` is
  ignored); since 2026-01-12 7-day and 28-day view windows return no data.

## 5. Ad account status

`account_status`: 1 ACTIVE, 2 DISABLED, 3 UNSETTLED, 7 PENDING_RISK_REVIEW, 8 PENDING_SETTLEMENT,
9 IN_GRACE_PERIOD, 100 PENDING_CLOSURE, 101 CLOSED, 201 ANY_ACTIVE, 202 ANY_CLOSED. `disable_reason` 0–15 are
mapped to readable texts (unknown future codes are shown as "Reason #N"). Only real changes are notified.

## 6. Error handling

| Code / subcode | Category | Behaviour |
|---|---|---|
| 4, 17, 32, 613, 80000–80014; subcodes 2446079, 1487742, 1504022, 1504039 | RATE_LIMIT | scope blocked for the header-provided or back-off time; jobs defer |
| 613 / 1487632 (budget changed more than 4 times per hour) | RATE_LIMIT | only that object's budget changes are blocked for an hour; rules skip it and continue |
| 613 / 1487225 (daily ad-creation limit) | VALIDATION | not retried; the launch fails the remaining objects with a clear message |
| 190 (subcodes 458, 459, 460, 463 expired, 464, 467, 492), 102 | AUTH | profile marked expired/invalid, owner notified, not retried |
| 10, 200–299, 294 | PERMISSION | the operation fails; the profile's token check is brought forward, and only `debug_token` (missing scopes) marks the profile *permission revoked* — an object-level error such as 200/1870034 never suspends a whole profile |
| 368 | POLICY | not retried; Meta's message shown |
| 803 | NOT_FOUND | object missing |
| 100 / 33 | VALIDATION | "deleted or no access" (can also be a missing permission, so the object is not marked deleted) |
| 1, 2, 3910001, `is_transient=true`, HTTP 5xx | TRANSIENT | retried with back-off (creation is reconciled first) |
| 100, other 4xx | VALIDATION | not retried; `error_user_title`/`error_user_msg` shown to the user |
| network before sending / through the proxy | NETWORK / PROXY | retried; proxy problems point to the profile's proxy |

Profile status changes and token inspections are written only if the token they were made with is still the
profile's current token (fingerprint compare-and-set): a late error from a replaced token never marks the new one
invalid. Every call is logged in `meta_api_logs` (method, path without secrets, status, code/subcode,
fbtrace_id, duration, retries, usage) for the Super Admin.

## 7. Rate limits

The rate-limit manager (Redis, shared by all workers) reads `X-App-Usage`, `X-Ad-Account-Usage`
(`acc_id_util_pct`, `reset_time_duration`), `X-Business-Use-Case-Usage` (`estimated_time_to_regain_access`) and
`X-FB-Ads-Insights-Throttle`:
- above the throttle threshold (75 %, configurable) calls to that scope are paced;
- above the pause threshold (90 %) or after a throttling error, the scope (app / token / ad account / business
  use case per ad account) is blocked until the regain time (or exponential back-off 1–30 min) — requests are
  not sent. A block is never shortened by a response that was already in flight;
- per-ad-account concurrency is limited (default 4);
- work is batched where Meta supports it (`?ids=` for accounts, pagination with `limit`), and discovery/stats are
  incremental. Rate limits are never "solved" with more tokens or proxies.

## 8. Tokens

`debug_token` reports type, app, expiry, data-access expiry and scopes. Required: `ads_management`, `ads_read`;
recommended: `business_management`, `pages_show_list`, `pages_read_engagement`; optional: `pages_manage_ads`,
`leads_retrieval`, `instagram_basic` (see README for what breaks without each). Tokens are re-checked on a
schedule; expiring tokens trigger a warning 7 days before expiry.

## 9. Limitations and supported alternatives

| Requirement / expectation | Reality in v26.0 | What AdPilot does |
|---|---|---|
| Messenger placements | No Messenger placement is available for new ads | Not offered; stored templates are cleaned on read |
| Instagram Explore feed | Removed in v26.0 | Only Explore home is offered |
| Long view attribution windows | Only 1-day view (and 1-day engage-through) | Offered windows are limited accordingly |
| "Maximum age" with Advantage+ audience | Fixed at 65+ | Validation error with explanation |
| Location exclusions for housing/employment/financial ads | Not supported | Validation error |
| Guaranteed immediate delivery after launch | Ads go through Meta review (`PENDING_REVIEW`) | Status shown; review results synced |
| Hourly statistics for any range | Hourly breakdowns are limited (no reach, 13 months of history) | Rules with "last N hours" use the hourly breakdown for up to 48 h |
| Faster statistics than Meta allows | Insights has its own throttle | Minimum 35 min interval + manual refresh cooldown |

## 10. Upgrading the Graph API version

1. Read the changelog of the new version and the out-of-cycle changes since the current one.
2. Check fields used in `meta-payloads.ts`, `entity-sync.service.ts`, `insights-sync.service.ts`,
   `rule-metrics.service.ts`, `meta-assets.service.ts`, `token-inspector.service.ts`, `meta-media.service.ts` and the
   enums in `packages/shared/src/meta/*` against the new SDK.
3. Update the emulator used by the tests if Meta changed validation rules; run the full test suite.
4. Change `META_GRAPH_API_VERSION`, deploy, watch the Meta API log for new errors (code 2635 = deprecated version).
