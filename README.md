# KCCG Slots App (Vercel MVP)

MVP web app for:
- querying specialist slots in text form
- daily sync from KCCG PDF report
- notifications when a slot opens or gets earlier

## What is implemented

- `GET /api/slots?q=...` search by specialist/department text
- `GET /api/cron/daily-sync` daily sync endpoint for Vercel Cron
- `POST /api/sync` manual sync endpoint (admin token)
- `POST /api/subscriptions` create/update subscription
- `GET /api/subscriptions?userId=...` list user subscriptions
- `DELETE /api/subscriptions?id=...` disable subscription
- `GET /api/notifications?userId=...` get user notifications
- `GET /api/push/public-key` returns VAPID public key for browser push
- `POST /api/push/test` send test push to `web_push` subscriptions (admin token)
- Simple UI on `/` for search + subscriptions + notifications

## Data source

- Homepage: `https://www.kccg.me/`
- Daily PDF link is extracted from homepage HTML.
- PDF text is parsed through `https://r.jina.ai/http://<pdf-url>`.

## Storage

- Primary: Upstash Redis (recommended on Vercel)
- Fallback: in-memory store (for local dev only)

## Environment variables

Required in production:

- `CRON_SECRET`: secures `/api/cron/daily-sync`
- `ADMIN_API_TOKEN`: secures `/api/sync` (optional; falls back to `CRON_SECRET`)
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
  - or `KV_REST_API_URL` and `KV_REST_API_TOKEN`
  - or `REDIS_URL` (Redis Cloud integration)

Optional:

- `TELEGRAM_BOT_TOKEN`: required only for telegram delivery channel
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`:
  required only for browser `web_push` delivery channel

## Local run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Vercel deployment

1. Import this project into Vercel.
2. Add environment variables from section above.
3. Ensure `vercel.json` is present (contains daily cron schedule).
4. Deploy.
5. Test:
   - `GET /api/health`
   - `POST /api/sync` with header `Authorization: Bearer <ADMIN_API_TOKEN>`
   - `GET /api/slots?q=neurologija`

## Notes

- PDF text from the source may contain malformed characters due to encoding quality on the source side.
- Matching uses normalized text search and may not be perfect for all variants.
- For production scale, replace naive subscription matching with indexed search and dedicated queueing for notification delivery.

## Browser Push Setup

1. Generate VAPID keys:
   - `npx web-push generate-vapid-keys`
2. Add to Vercel env:
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (for example `mailto:you@example.com`)
3. In UI select `channel=web_push` and save a subscription.
4. Send test push:
   - `POST /api/push/test`
   - Header: `Authorization: Bearer <ADMIN_API_TOKEN>`
   - Optional JSON body: `{ "userId": "demo-user", "title": "Test", "message": "Push works" }`

## Install On Phone (PWA)

1. Open deployed app URL in mobile browser (HTTPS).
2. Android Chrome: menu -> `Add to Home screen`.
3. iPhone Safari: share -> `Add to Home Screen`.
