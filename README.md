# Houzs Hub

Central IT ticketing for the group's systems: Hookka (`HK`), Houzs Century (`HC`),
2990s (`2990`), Conts (`CONTS`) and Houzs Connect (`CONNECT`). Each ticket is coded
`<SYSTEM>-<0000>`, for example `HK-0012`.

One Cloudflare Worker (`backend/`) serves the API and the developer portal, a React
app built into `frontend/dist` and served as Workers static assets. Data lives in
Supabase Postgres, reached through Cloudflare Hyperdrive. Attachments live in R2.
Open portal tabs get live updates from a Durable Object.

```
reporting system backend --Bearer key + X-Reporter-Id--> /api/v1/sys/*   (one API key per system)
developer browser        --session cookie (/login)----> /api/v1/dev/*   + portal
```

Reporters never open the hub. They raise and follow tickets from the IT Support page
inside their own system, whose backend calls `/api/v1/sys`.

## Local development

```bash
docker run -d --name hub-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
npm run install:all
printf 'SESSION_SECRET=any-long-random-string\n' > backend/.dev.vars
printf 'DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres\n' > backend/.env
npm run db:migrate
npm --prefix backend run key:issue -- HK
npm --prefix backend run user:set -- you@gmail.com yourname   # prints a password
npm run build            # wrangler needs frontend/dist to exist
npm run dev              # backend on :8787, frontend on http://localhost:5180
```

Where each part reads its database from:

- `wrangler dev` uses `localConnectionString` in `backend/wrangler.toml` (the Docker
  Postgres above), unless `DATABASE_URL` in `backend/.env` is Supabase. Then
  `npm run dev` points it at that database through the transaction pooler.
- The scripts (`db:migrate`, `key:issue`, `user:set`) use `DATABASE_URL` from
  `backend/.env`.

> **Check which database you are on.** If either of those points at Supabase, local
> dev and every script read and write production data. There is no staging site.
> Do not run deletes, migrations or test submissions against production by accident.

Attachments are the exception: `wrangler dev` keeps R2 in a local, empty bucket, so
files uploaded in production show as broken images locally.

## Accounts and permissions

Developers sign in at `/login` with their username or email and a password. There is
no sign-up page; admins add people on the **Users** page. What each person can do
comes from their role, set on the **Roles** page:

| Permission | Gives access to |
|---|---|
| IT tickets | List, Board, My queue, Notifications and every system's tickets |
| Delete tickets | Removing a ticket with its comments and files for good |
| Manage users | The Users page: add people, reset passwords, switch accounts off or on |
| Manage roles | The Roles page, plus assigning roles and per-person overrides on Users |
| See Integrations | The Integrations page: whether each system is connected |
| See account ownership | The Account ownership page: every outside account and who controls it |
| Edit account ownership | Adding, changing and removing accounts on the Account ownership page |
| See system billing | The System billing pages under Finance: what each service costs and which card pays |
| Edit system billing | Adding, changing and removing charges, cards and statement lines |
| See system health | The System health page: each system up or down, its speed and version, checked every 5 minutes, and the health report it sends |
| Edit system health | Adding, changing and pausing the systems the hub checks, and Check now |

The Finance pages (Account ownership and System billing) replace the API card register sheet (all its tabs:
Ownership, Register, Overview, Cards, Statement lines, Monthly tally and Trend). Card
statement lines are added on the page, one by one or pasted from a statement. They hold names, emails, roles, amounts and the last
4 digits of a card only, never passwords, API keys or full card numbers. To load the
sheet once, copy each tab (with its header row) into a `.tsv` file and run, from
`backend/`, each command first as a dry run and then again with `--apply`:

```bash
node scripts/import-accounts.mjs ownership.tsv
node scripts/import-billing.mjs --register register.tsv --cards cards.tsv
```

Two roles are built in and can be renamed but not deleted: **Admin** has every
permission and **Developer** has IT tickets. New permissions are added in
`backend/src/services/perms.ts`.

On the Users page, **Permissions** sets Inherit, Allow or Deny for one person;
Deny always wins.

Account rules:

- Nobody can change their own role, overrides or on/off switch.
- The hub refuses any change that would leave no active user able to manage roles.
- A password handed out by an admin (a new account or a reset) works for one sign-in
  only. The hub then asks the person to choose their own, so the admin never knows it.
- Five wrong passwords lock an account for 15 minutes; an admin reset clears the lock.
- Switching someone off signs them out at once. A password reset does not end
  sessions they already have.
- Everyone can change their own password, display name and email on **My account**
  (click your name in the sidebar).

The first admin is made once from the command line. It prints a random password once,
for the database `DATABASE_URL` points at (the script prints which):

```bash
npm --prefix backend run user:set -- you@gmail.com yourname --admin
```

Without `--admin`, the same script creates or resets any account.

## Deploying

### First deploy

1. Create a Supabase project. Create a Hyperdrive config in Cloudflare with its
   connection string, and put the config id in `backend/wrangler.toml`.
2. `wrangler r2 bucket create houzs-it-hub`.
3. Put the Supabase session pooler string in `backend/.env` as `DATABASE_URL`
   (gitignored), then run `npm run db:migrate`.
4. Add a custom domain for the Worker.
5. `cd backend && npx wrangler secret put SESSION_SECRET` (a long random string).
6. `npm run deploy`.
7. `npm --prefix backend run key:issue -- HK` and store the printed key in Hookka as
   `IT_HUB_API_KEY`. Repeat with each system's code.
8. `npm --prefix backend run user:set -- <email> <username> --admin` for the first
   admin. Everyone else is added from the Users page.

### After the first

`.github/workflows/deploy.yml` type-checks and builds every pull request. A merge to
`main` runs the same checks, applies pending migrations, then deploys the Worker.

It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN`: the "Edit Cloudflare Workers" template, on the account in
  `backend/wrangler.toml`.
- `DATABASE_URL`: the Supabase session pooler string, for migrations.

Secrets such as `SESSION_SECRET` stay in Cloudflare and are not touched by a deploy.

Migrations are the numbered files in `backend/src/db/migrations`. Each runs once and
is recorded by file name, so never edit one that has already been applied; add a new
file instead. `000_baseline.sql` is the whole database as of 2026-10-15 (it replaced
001 to 019); new changes start at 020.

## System API (`/api/v1/sys`)

Every call sends `Authorization: Bearer <key>` and `X-Reporter-Id: <the reporter's
user id in that system>`. A reporter only ever sees their own tickets and public
replies.

| Method | Path | Sends or returns |
|---|---|---|
| POST | `/tickets` | Multipart or JSON. Required: `title`, `reporter_name`. Optional: `description`, `type` (`bug`, `development`), `priority` (`urgent`, `high`, `medium`, `low`), `occurred_at` (defaults to the submission time), `reporter_email`, `reporter_phone`, `reporter_department`, `page_url`, `user_agent`, `app_version`, `files` (up to 5, 10 MB each; images, mp4, mov or pdf) |
| GET | `/tickets` | Own tickets with an `unread` flag, most recently updated first. Optional `status` (comma list), `page`, `page_size` (up to 200). Without paging it returns the newest 200. Also returns `total`. |
| GET | `/tickets/unread-count` | `{ unread }` for the badge |
| GET | `/tickets/:code` | The ticket and its public events; marks it seen |
| POST | `/tickets/:code/replies` | `body`, `files`. Moves Waiting Reporter or Done back to On Going. |
| POST | `/tickets/:code/confirm` | Done to Closed |
| GET | `/attachments/:id` | The file (own tickets, public events only) |

Statuses: `open`, `in_progress` (On Going), `on_hold`, `testing`, `waiting_reporter`,
`resolved` (Done), `closed`, `rejected`. Done tickets close themselves after 7 days.

### Health report (`POST /api/v1/sys/health`)

A system sends its own health report every 5 minutes with the same key, and **no**
`X-Reporter-Id` (no person is involved). The System health page shows the newest one in
that system's tab and warns when none has arrived for 15 minutes; 7 days are kept. The
body is JSON, 64 KB at most, in the shape The Conts' `GET /api/system/health` already
returns (`measureHealth` in Conts-ERP `functions/_lib/systemHealth.ts`, sent by its cron
worker's `hubHealthReport`). Every field is optional except `ok`; anything else is dropped.

```json
{
  "ok": true,
  "time": "2026-10-21T04:00:00Z",
  "db": { "ok": true, "latency_ms": 19 },
  "r2": { "bound": true, "ok": true, "latency_ms": 40 },
  "counts": { "users_active": 12, "audit_24h": 140, "last_event_at": "2026-10-21T03:58:00Z" },
  "checks": [
    { "key": "email", "label": "Email", "value": "Set", "status": "ok", "summary": "52 sent in 7 days", "detail": "optional longer note" }
  ],
  "problems": [
    { "at": "2026-10-21T02:10:00Z", "what": "A guest message could not be sent", "where": "Unit 12-3", "error": "Refused (429)" }
  ]
}
```

`ok` false means something needs attention. `status` is `ok`, `warning`, `critical` or
`off`. `storage` may be sent instead of `r2`. Never put a password, key or personal data
beyond what the system's own health page shows. The answer is `201 { ok: true }`, or 401
for a wrong key.
