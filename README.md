# Houzs IT Hub

Central ticketing for Hookka (HK), Houzs Century (HC), 2990s (2990) and Conts (CONTS).
One Cloudflare Worker (`backend/`) serves both the API and the developer portal SPA
(`frontend/dist` via Workers static assets). Supabase Postgres for data (reached
through Cloudflare Hyperdrive), R2 for attachments.

```
reporting system backend --Bearer key + X-Reporter-Id--> /api/v1/sys/*   (per-system API key)
developer browser        --session cookie (/login)----> /api/v1/dev/*   + SPA
```

## Local dev

Needs a local Postgres. The Worker reads it through `localConnectionString` in
`backend/wrangler.toml`; the scripts read `DATABASE_URL` from `backend/.env`.

```bash
docker run -d --name hub-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
npm run install:all
printf 'SESSION_SECRET=any-long-random-string\n' > backend/.dev.vars
printf 'DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres\n' > backend/.env
npm run db:migrate
npm --prefix backend run key:issue -- HK
npm --prefix backend run user:set -- you@gmail.com yourname   # prints a password
npm run build            # wrangler needs frontend/dist to exist
npm run dev:backend      # :8787
npm run dev:frontend     # :5180, proxies /api to :8787
```

## Developer accounts

Developers sign in at `/login` with their username or email plus a password.
There is no sign-up page. Two roles:

- **Admin**: everything below, plus the **Users** page (add people, reset
  passwords, change roles, switch accounts off or on). An admin cannot change
  their own role or switch themselves off.
- **Developer**: tickets only.

Everyone can change their own password on **My account** (click your name in
the sidebar). Five wrong passwords lock an account for 15 minutes; an admin
reset clears the lock. Switching someone off signs them out at once; a password
reset does not end sessions they already have.

The first admin is made once from the command line. It prints a random password
once, for the database `DATABASE_URL` points at (the script prints which):

```bash
npm --prefix backend run user:set -- you@gmail.com yourname --admin
```

The same script (without `--admin`) still works as a fallback for creating or
resetting any account.

## First deploy

1. Create a Supabase project. Create a Hyperdrive config in Cloudflare with its
   connection string and put the config id in `backend/wrangler.toml`.
2. `wrangler r2 bucket create houzs-it-hub`.
3. Put the Supabase session pooler string in `backend/.env` as `DATABASE_URL`
   (gitignored), then `npm run db:migrate`.
4. Add a custom domain for the Worker.
5. `cd backend && npx wrangler secret put SESSION_SECRET` (a long random string).
6. `npm run deploy`.
7. `npm --prefix backend run key:issue -- HK` and store the printed key in
   Hookka as `IT_HUB_API_KEY`.
8. `npm --prefix backend run user:set -- <email> <username>` for each developer.

## Deploys after the first

`.github/workflows/deploy.yml` type-checks and builds every pull request. A merge
to `main` then applies pending migrations and deploys the Worker. It needs two
repository secrets: `CLOUDFLARE_API_TOKEN` (the "Edit Cloudflare Workers" template
on the account in `backend/wrangler.toml`) and `DATABASE_URL`
(the Supabase session pooler string, for migrations). Secrets such as
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
