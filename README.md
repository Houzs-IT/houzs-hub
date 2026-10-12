# Houzs IT Hub

Central ticketing for Hookka (HK), Houzs Century (HC) and 2990s (2990).
One Cloudflare Worker (`backend/`) serves both the API and the developer portal SPA
(`frontend/dist` via Workers static assets). D1 for data, R2 for attachments.

```
reporting system backend --Bearer key + X-Reporter-Id--> /api/v1/sys/*   (per-system API key)
developer browser        --Cloudflare Access JWT-------> /api/v1/dev/*   + SPA
```

## Local dev

```bash
npm run install:all
printf 'DEV_AUTH_EMAIL=you@houzs.local\n' > backend/.dev.vars
npm run db:migrate:local
npm --prefix backend run key:issue -- HK --local
npm run build            # wrangler needs frontend/dist to exist
npm run dev:backend      # :8787
npm run dev:frontend     # :5180, proxies /api to :8787
```

`DEV_AUTH_EMAIL` is only honoured for `localhost` / `127.0.0.1` requests.

## First deploy

1. `wrangler d1 create houzs-it-hub` and put the id in `backend/wrangler.toml`.
2. `wrangler r2 bucket create houzs-it-hub`.
3. `npm run db:migrate`.
4. Add a custom domain for the Worker.
5. Zero Trust > Access > Applications, self-hosted, on that domain:
   - Allow policy: developer emails.
   - Second application on path `/api/v1/sys` with a **Bypass** policy (systems
     authenticate with their API key, not Access).
   - Copy the team domain (`<team>.cloudflareaccess.com`) and the AUD tag into
     `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.toml`.
6. `npm run deploy`.
7. `npm --prefix backend run key:issue -- HK` and store the printed key in
   Hookka as `IT_HUB_API_KEY`.

## System API (`/api/v1/sys`)

Headers on every call: `Authorization: Bearer <key>`, `X-Reporter-Id: <user id in that system>`.

| Method | Path | Body |
|---|---|---|
| POST | `/tickets` | multipart or JSON: `title`*, `reporter_name`*, `description`, `type` (bug, development), `priority` (urgent, high, medium, low), `occurred_at`, `reporter_email`, `reporter_phone`, `reporter_department`, `page_url`, `user_agent`, `app_version`, `files` (max 5, 10 MB, image / mp4 / mov / pdf) |
| GET | `/tickets?status=` | own tickets with `unread` flag |
| GET | `/tickets/unread-count` | `{ unread }` for the badge |
| GET | `/tickets/:code` | ticket + public events; marks it seen |
| POST | `/tickets/:code/replies` | `body`, `files`; moves Waiting Reporter / Done back to On Going |
| POST | `/tickets/:code/confirm` | Done -> Closed |
| GET | `/attachments/:id` | file stream (own, public only) |

Statuses: `open`, `in_progress` (On Going), `on_hold`, `testing`, `waiting_reporter`,
`resolved` (Done), `closed`, `rejected`. Done tickets close themselves after 7 days.
