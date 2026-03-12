# AGENTS.md

Last updated: 2026-03-12

This file is operational memory for the project, to avoid re-discovery after outages.

## 1) Project Goal (confirmed)

- Public web app and Telegram bot for KCCG availability:
  - user asks by free text;
  - app returns whether slots exist and first available date/time;
  - app can notify when a slot appears or becomes earlier.
- Secondary feature:
  - "Kad ordinira?" doctor schedule lookup from KCCG Poliklinika page.

## 2) Current Architecture (confirmed)

- Framework: Next.js App Router (TypeScript).
- Main UI: `app/page.tsx`
- Core APIs:
  - slots search: `app/api/slots/route.ts`
  - slots sync: `app/api/sync/route.ts`
  - daily cron sync: `app/api/cron/daily-sync/route.ts`
  - sync diagnostics: `app/api/sync/last/route.ts`
  - doctor schedule search: `app/api/schedule/route.ts`
  - doctor schedule sync: `app/api/schedule/sync/route.ts`
  - schedule cron sync: `app/api/cron/schedule-sync/route.ts`
  - subscriptions: `app/api/subscriptions/route.ts`
  - notifications: `app/api/notifications/route.ts`
  - push test/public key: `app/api/push/test/route.ts`, `app/api/push/public-key/route.ts`
  - telegram webhook/status: `app/api/telegram/webhook/route.ts`, `app/api/telegram/status/route.ts`
  - health: `app/api/health/route.ts`
  - usage stats: `app/api/usage/route.ts`
- Storage:
  - primary: Redis (Upstash REST or Redis TCP via `REDIS_URL`);
  - fallback: in-memory (`lib/storage.ts`) for local/dev only.
- KCCG slot data source:
  - homepage: `https://www.kccg.me/`
  - PDF discovered from homepage HTML
  - PDF parsed through `https://r.jina.ai/http://<pdf-url>`
- Schedule data source:
  - `https://www.kccg.me/poliklinika/poliklinika-kccg/`
  - accordion HTML parser in `lib/poliklinikaSchedule.ts`

## 3) Current Working Logic (confirmed)

### Slots

- `/api/slots` reads latest snapshot from storage.
- If missing snapshot, fetches and saves.
- Background self-heal check (`SLOTS_META_CHECK_INTERVAL_SEC`, default 900s):
  - fetch latest PDF metadata;
  - if newer PDF found, refresh snapshot.
- Matching logic:
  - free text + transliteration/alias expansion;
  - pediatric rows hidden unless child intent detected;
  - administrative rows excluded.
- Custom intent pipelines in `app/api/slots/route.ts`:
  - CT/OCT/MR/UZ/EMNG;
  - neurology grouped output;
  - endocrinology/cardiology/ORL/oncology custom ordering;
  - gastro logic:
    - `gastro` -> gastro ambulanta first, then endoscopy;
    - `gastroskopija`/`kolonoskopija` -> procedure-first ordering.
- Notification trigger logic (`lib/notify.ts`):
  - new specialist with slots;
  - slots opened (`NO_SLOTS -> HAS_SLOTS`);
  - earlier slot detected (`EARLIER_SLOT`).

### Schedule ("Kad ordinira?")

- `/api/schedule` reads cached schedule snapshot.
- Auto-refresh if snapshot missing or parser version outdated.
- Search includes doctor, ambulanta, schedule, location.
- Handles transliteration + token variants.
- Oculoplastic vs plastic scoping present.
- Gastro ordering also applied in schedule search.

### Bot

- Webhook route: `app/api/telegram/webhook/route.ts`
- Supports `/start`, `/help`, `/sub`, `/list`, `/unsub`, `/unsuball`, `/sync`.
- For regular query text:
  - sends "Treba mi 10 sekundi.";
  - then returns status summary (`IMA TERMINA`/`NEMA TERMINA`) + details.

## 4) Non-negotiable Constraints (confirmed from code + product decisions)

- UI language and labels are mostly Montenegrin/BCS (not English-first).
- Slot status labels in UI: `IMA TERMINA` / `NEMA TERMINA`.
- Subscription disclaimer text in UI is legally/expectation sensitive; keep intent unchanged.
- Do not expose secrets in code, logs, screenshots, commits:
  - `ADMIN_API_TOKEN`, `CRON_SECRET`, Redis tokens, Telegram token, VAPID private key.
- Production should use Redis; in-memory in production is a degraded mode.
- Cron endpoints require auth (`CRON_SECRET`).
- Admin endpoints require auth (`ADMIN_API_TOKEN` or fallback to `CRON_SECRET`).

## 5) Known Issues / Risk Areas (confirmed)

- Upstream KCCG PDF format can change and break parsing quality.
- OCR/encoding artifacts can introduce malformed characters in specialist names.
- `r.jina.ai` or upstream availability can fail transiently.
- User misconfiguration patterns causing auth failures:
  - pasting `ADMIN_API_TOKEN=<value>` into value field instead of raw token;
  - quoted values or truncated token copied from masked UI.
- Telegram may show bot as healthy while webhook URL is empty/wrong.
- Schedule parser edge cases:
  - mixed title/noise fragments in day lines;
  - same surname with different doctors/ambulante;
  - irregular second-shift formatting by ambulanta block.

## 6) What Has Already Been Tried (confirmed)

- Multi-strategy PDF parsing (`legacy`, `modern`, `hybrid`) + best-score selection.
- Sync self-heal:
  - retry suspicious snapshot parse;
  - quality scoring + debug telemetry.
- Ops self-heal in daily sync:
  - usage threshold alerts;
  - stale source alerts;
  - Redis fallback alerts;
  - Telegram webhook auto-repair.
- Parser hardening for schedule:
  - better name normalization;
  - title cleanup;
  - day/time extraction and unification.
- Domain-specific ordering/custom grouping for major specialties and diagnostics.

## 7) Important Files (confirmed)

- Product/API logic:
  - `app/api/slots/route.ts`
  - `app/api/sync/route.ts`
  - `app/api/cron/daily-sync/route.ts`
  - `app/api/schedule/route.ts`
  - `app/api/schedule/sync/route.ts`
  - `app/api/cron/schedule-sync/route.ts`
  - `app/api/telegram/webhook/route.ts`
  - `app/api/telegram/status/route.ts`
- Data/parsing:
  - `lib/kccg.ts`
  - `lib/poliklinikaSchedule.ts`
  - `lib/sync.ts`
  - `lib/scheduleSync.ts`
  - `lib/notify.ts`
  - `lib/storage.ts`
  - `lib/auth.ts`
- Config/docs:
  - `vercel.json`
  - `.env.example`
  - `README.md`

## 8) Deployment Workflow + Failure Points (confirmed)

### Standard workflow

1. Local checks:
   - `npm run typecheck`
   - `npm run build` (optional but recommended before prod deploy)
2. Commit only relevant files.
3. `git push origin main`
4. `vercel --prod --yes`
5. Post-deploy smoke checks:
   - `/api/health`
   - `/api/sync/last` (admin auth)
   - `/api/telegram/status`
   - sample `/api/slots?q=<query>`
   - sample `/api/schedule?q=<query>`

### Frequent failure points

- Not logged in Vercel CLI (`vercel login` needed).
- Wrong project link in `.vercel/project.json`.
- Env vars changed but deployment not redeployed.
- `401 Unauthorized` due to malformed admin token.
- Network/DNS issues during remote checks.
- Redis not connected -> app silently falls back to in-memory (see `/api/health`).

## 9) Ambiguities / Needs Confirmation (open questions)

- Paid subscriptions/monetization: not implemented yet.
- Final product/legal text policy for medical disclaimers in all channels.
- Exact list of specialties that should be grouped/simplified in bot vs web may evolve.
- Schedule parsing tolerance for all non-standard ambulanta blocks is still iterative.

## 10) Environment Baseline (confirmed from `.env.example`)

Core:
- `CRON_SECRET`
- `ADMIN_API_TOKEN`
- Redis:
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or
  - `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or
  - `REDIS_URL`

Telegram/push:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (recommended)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Ops knobs:
- `APP_BASE_URL`
- `ADMIN_TELEGRAM_CHAT_ID`
- `MONTHLY_API_LIMIT` (default 100000)
- `API_USAGE_ALERT_THRESHOLD` (default 0.8)
- `OPS_SNAPSHOT_STALE_DAYS` (default 2)
- `OPS_TELEGRAM_WEBHOOK_SELF_HEAL` (default true)
- `SCHEDULE_SYNC_MIN_DAYS` (default 15)

## 11) Operational Runbook (quick)

- Check runtime + storage mode:
  - `GET /api/health`
- Check last slot sync diagnostics:
  - `GET /api/sync/last` (admin auth)
- Check Telegram:
  - `GET /api/telegram/status`
- Check usage pacing:
  - `GET /api/usage` (admin auth)
- Force syncs:
  - `POST /api/sync` (admin auth)
  - `POST /api/schedule/sync` (admin auth)

## 12) Editing Rules For Future Agents

- Prefer minimal diffs to existing logic; avoid broad refactors in one patch.
- Keep domain ordering rules explicit and test with real sample queries.
- Do not change user-facing copy without explicit request.
- When fixing parsing, add debug breadcrumbs (`setDebugValue`) for observability.
- Before deploy, ensure only intended files are staged.
- Never include secret values in commits or chat replies.

