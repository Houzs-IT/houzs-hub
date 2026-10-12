# Houzs IT Hub

Central ticketing for Hookka (HK), Houzs Century (HC) and 2990s (2990).
One Cloudflare Worker (`backend/`) serves both the API and the developer portal SPA
(`frontend/dist` via Workers static assets). D1 for data, R2 for attachments.

```
reporting system backend --Bearer key + X-Reporter-Id--> /api/v1/sys/*   (per-system API key)
developer browser        --session cookie (/login)----> /api/v1/dev/*   + SPA
```

## Local dev

```bash
npm run install:all
printf 'SESSION_SECRET=any-long-random-string\n' > backend/.dev.vars
npm run db:migrate:local
npm --prefix backend run key:issue -- HK --local
npm --prefix backend run user:set -- you@gmail.com yourname --local   # prints a password
npm run build            # wrangler needs frontend/dist to exist
npm run dev:backend      # :8787
npm run dev:frontend     # :5180, proxies /api to :8787
```

## Developer accounts

Developers sign in at `/login` with their username or email plus a password.
There is no sign-up page. Create an account or reset a password with:

```bash
npm --prefix backend run user:set -- samuel@gmail.com samuel
```

It prints a new random password once (add `--local` for the local DB). The
username is optional on a reset. Five wrong passwords lock the account for
15 minutes; running the script again also clears the lock. To block someone,
set `developers.active = 0`.

## First deploy

1. `wrangler d1 create houzs-it-hub` and put the id in `backend/wrangler.toml`.
2. `wrangler r2 bucket create houzs-it-hub`.
3. `npm run db:migrate`.
4. Add a custom domain for the Worker.
5. `cd backend && npx wrangler secret put SESSION_SECRET` (a long random string).
6. `npm run deploy`.
7. `npm --prefix backend run key:issue -- HK` and store the printed key in
   Hookka as `IT_HUB_API_KEY`.
8. `npm --prefix backend run user:set -- <email> <username>` for each developer.

## Deploys after the first

`.github/workflows/deploy.yml` type-checks and builds every pull request. A merge
to `main` then applies pending migrations and deploys the Worker. It needs the
repository secret `CLOUDFLARE_API_TOKEN` (Workers Scripts, Workers Routes, R2 and
D1 edit on the account in `backend/wrangler.toml`). Secrets such as
`SESSION_SECRET` stay in Cloudflare and are not touched by a deploy.

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
