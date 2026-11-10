# Houzs IT Hub

The group's central IT desk at <https://support.houzscentury.com>. Staff raise IT
tickets from inside their own system; developers pick them up here. The hub also
watches each system's health and keeps the Finance register of outside accounts and
what each service costs.

| Code | System | Ticket codes |
|---|---|---|
| `HK` | Hookka | `HK-0001` |
| `HC` | Houzs Century (Houzs ERP) | `HC-0001` |
| `2990` | 2990s | `2990-0001` |
| `CONTS` | Conts | `CONTS-0001` |
| `CONNECT` | Houzs Connect | `CONNECT-0001` |
| `CARRES` | Carres | `CARRES-0001` |

## How it fits together

```
reporting system backend --Bearer key + X-Reporter-Id--> /api/v1/sys/*   (one API key per system)
developer browser        --session cookie (/login)----> /api/v1/dev/*   + the portal
```

- **Reporters never open the hub.** They raise and follow tickets on the IT Support
  page inside their own system. That system's backend calls `/api/v1/sys` with its key.
- **Developers** sign in at `/login` and work in the portal: List, Board, My queue,
  Notifications, Reports, System health and the Finance pages.
- **One Cloudflare Worker** (`backend/`, Hono) serves the API and the portal. The
  portal is a React app (`frontend/`, Vite + Tailwind) built into `frontend/dist` and
  served as Workers static assets.
- **Data** lives in Supabase Postgres, reached through Cloudflare Hyperdrive.
  **Attachments** live in R2. Open portal tabs get **live updates** from a Durable Object.
- **A cron every 5 minutes** runs the health checks. The 10:00 (GMT+8) run also closes
  Done tickets older than 7 days and reads Anthropic costs.

```
backend/
  src/routes/          API routes (sys*, dev, admin, auth, billing, health, ...)
  src/services/        business rules (tickets, permissions, health, reports, ...)
  src/db/migrations/   numbered SQL migrations
  scripts/             command-line tools (migrate, keys, users, one-off imports)
frontend/src/
  pages/               one file per portal page
  components/, lib/    shared UI and helpers
scripts/dev.mjs        starts backend and frontend together
```

## Local development

> **Warning: local dev can run on the live database.** There is no staging site. If
> `DATABASE_URL` in `backend/.env` points at Supabase, local dev and every script read
> and write production data. Never run deletes, migrations or test submissions there
> by accident. `npm run dev` prints a warning when this is the case.

With a throwaway Postgres in Docker:

```bash
docker run -d --name hub-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:17
npm run install:all
printf 'SESSION_SECRET=any-long-random-string\n' > backend/.dev.vars
printf 'DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres\n' > backend/.env
npm run db:migrate
npm --prefix backend run key:issue -- HK
npm --prefix backend run user:set -- you@gmail.com yourname --admin   # prints a password
npm run build            # wrangler needs frontend/dist to exist
npm run dev              # backend on :8787, frontend on http://localhost:5180
```

Which database each part uses:

- `wrangler dev` uses `localConnectionString` in `backend/wrangler.toml` (the Docker
  Postgres above). If `DATABASE_URL` in `backend/.env` is Supabase, `npm run dev`
  points it there instead, through the transaction pooler (port 6543).
- The scripts (`db:migrate`, `key:issue`, `user:set` and the imports) use
  `DATABASE_URL` from `backend/.env`, and print which database they are on.
- R2 is always a local, empty bucket under `wrangler dev`, so files uploaded in
  production show as broken images locally.

### Commands

Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `npm run install:all` | Installs backend and frontend packages |
| `npm run dev` | Starts backend and frontend together |
| `npm run typecheck` | Type-checks backend and frontend |
| `npm run build` | Builds the portal into `frontend/dist` |
| `npm run db:migrate` | Applies pending migrations to `DATABASE_URL` |
| `npm run deploy` | Builds, type-checks and deploys the Worker |
| `npm --prefix backend run key:issue -- <CODE>` | Issues or rotates a system's API key and prints it once |
| `npm --prefix backend run user:set -- <email> [username] [--admin]` | Creates an account or resets a password and prints it once |

## Accounts and permissions

Developers sign in with their username or email and a password. There is no sign-up
page: admins add people on the **Users** page. The very first admin is made from the
command line:

```bash
npm --prefix backend run user:set -- you@gmail.com yourname --admin
```

Without `--admin` the same script creates a Developer account, or resets the password
of an existing one and keeps its roles.

A person can hold **several roles**; they get every permission of all of them. On
the Users page, **Permissions** can also set Inherit, Allow or Deny per person, and
Deny always wins. Roles are managed on the **Roles** page.

| Permission | Gives access to |
|---|---|
| IT tickets | List, Board, My queue, Reports and every system's tickets |
| Get notifications | The bell, the unread count, and new-ticket pop-ups and sounds (needs IT tickets too) |
| Delete tickets | Removing a ticket with its comments and files for good, and deleting anyone's comment |
| Manage users | The Users page: add people, reset passwords, switch accounts off or on |
| Manage roles | The Roles page, plus assigning roles and per-person overrides on Users |
| See Integrations | The Integrations page: whether each system is connected |
| See account ownership | The Account ownership page: every outside account and who controls it |
| Edit account ownership | Adding, changing and removing accounts there |
| See system billing | The System billing pages: what each service costs and which card pays |
| Edit system billing | Adding, changing and removing charges, cards and statement lines |
| See system health | The System health page: each system up or down, its speed, version and health report |
| Edit system health | Adding, changing and pausing the systems the hub checks, and Check now |

Two roles are built in. They can be renamed but not deleted:

- **Admin** starts with every permission except Get notifications.
- **Developer** starts with IT tickets and Get notifications.

To add a permission, add it to `backend/src/services/perms.ts` and guard its routes
with `need("<key>")`. It then shows as a switch on the Roles page.

Account rules:

- Nobody can change their own roles, overrides or on/off switch.
- The hub refuses any change that would leave no active user able to manage roles.
- A password handed out by an admin (new account or reset) works for one sign-in
  only. The hub then asks the person to choose their own.
- Five wrong passwords lock an account for 15 minutes. An admin reset clears the lock.
- Switching someone off signs them out at once. A password reset does not end
  sessions they already have.
- Everyone can change their own password, display name and email on **My account**
  (click your name in the sidebar).

## Finance pages

**Account ownership** and **System billing** replace the old API card register sheet.
They hold names, emails, roles, amounts and the last 4 digits of a card only. Never
store passwords, API keys or full card numbers there.

Card statement lines are added on the page, one by one or pasted from a statement.
To load the old sheet once, copy each tab (with its header row) into a `.tsv` file and
run these from `backend/`. Each runs as a dry run first; add `--apply` to write:

```bash
node scripts/import-accounts.mjs ownership.tsv
node scripts/import-billing.mjs --register register.tsv --cards cards.tsv
```

Costs can also arrive on their own:

- **Anthropic:** with the Worker secret `ANTHROPIC_ADMIN_KEY` (an Admin API key,
  `sk-ant-admin...`, of the company organisation), the hub reads the cost per workspace
  once a day and on "Read now", to split Anthropic credit between systems. Without it
  nothing is read.
- **From the systems themselves:** see `ai-usage` and `usage-costs` under the System API.

## Database migrations

Migrations are the numbered `.sql` files in `backend/src/db/migrations`. Each runs
once, in its own transaction, and is recorded by file name.

- Never edit a migration that has already run. Add a new file with the next number.
- `000_baseline.sql` is the whole database as of 2026-10-15. It replaced the first
  19 migrations; a database that already ran those records it without running it.
- A new table gets row level security enabled in the same file. A new column you
  filter or sort on gets an index in the same file.
- Write the down step as a comment at the end of the file.

## Deploying

### Every deploy

`.github/workflows/deploy.yml` type-checks and builds every pull request. A merge to
`main` runs the same checks, applies pending migrations, then deploys the Worker.

It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN`: the "Edit Cloudflare Workers" template, on the account in
  `backend/wrangler.toml`.
- `DATABASE_URL`: the Supabase session pooler string, for migrations.

### Worker secrets

Set with `cd backend && npx wrangler secret put <NAME>`. A deploy never touches them.

| Secret | Needed | What for |
|---|---|---|
| `SESSION_SECRET` | Yes | Signs session cookies. A long random string. |
| `RESEND_API_KEY` | Optional | Sends health alert emails to `HEALTH_ALERT_TO` (set in `wrangler.toml`). |
| `ANTHROPIC_ADMIN_KEY` | Optional | Reads Anthropic costs for System billing. |

### First deploy (one time)

1. Create a Supabase project. Create a Hyperdrive config in Cloudflare with its
   connection string, with query caching off, and put its id in `backend/wrangler.toml`.
2. `npx wrangler r2 bucket create houzs-it-hub`.
3. Put the Supabase session pooler string in `backend/.env` as `DATABASE_URL`
   (gitignored), then run `npm run db:migrate`.
4. Point the custom domain in `backend/wrangler.toml` at the Worker.
5. Set `SESSION_SECRET` (see Worker secrets).
6. `npm run deploy`.
7. For each system, run `npm --prefix backend run key:issue -- <CODE>` and store the
   printed key in that system as `IT_HUB_API_KEY`.
8. Make the first admin with `user:set ... --admin`. Everyone else is added on the
   Users page.

## System API (`/api/v1/sys`)

Every call sends `Authorization: Bearer <key>`. Ticket calls also send
`X-Reporter-Id: <the reporter's user id in that system>`. A reporter only ever sees
their own tickets and public replies.

### Tickets

| Method | Path | Sends or returns |
|---|---|---|
| POST | `/tickets` | Multipart or JSON. Required: `title`, `reporter_name`. Optional: `description`, `type` (`bug`, `development`), `priority` (`high`, `medium`, `low`; `urgent` is taken as `high`), `occurred_at` (defaults to now), `reporter_email`, `reporter_phone`, `reporter_department`, `page_url`, `module` (the part of the system, e.g. `Sales Order`, up to 60 characters, shown in Reports by module), `user_agent`, `app_version`, `files` (up to 5, 10 MB each; images, mp4, mov or pdf) |
| GET | `/tickets` | Own tickets with an `unread` flag and `total`, most recently updated first. Optional `status` (comma list), `page`, `page_size` (up to 200). Without paging it returns the newest 200. |
| GET | `/tickets/unread-count` | `{ unread }` for the badge |
| GET | `/tickets/:code` | The ticket and its public events; marks it seen |
| POST | `/tickets/:code/replies` | `body`, `files`. Moves Waiting Reporter or Done back to On Going. |
| POST | `/tickets/:code/confirm` | Done to Closed |
| GET | `/attachments/:id` | The file (own tickets, public events only) |

Statuses: `open`, `in_progress` (On Going), `on_hold`, `testing`, `waiting_reporter`,
`resolved` (Done), `closed`, `rejected`. Done tickets close themselves after 7 days.

### Health report: `POST /health`

A system sends its own health report every 5 minutes, with **no** `X-Reporter-Id`.
The System health page shows the newest one in that system's tab and warns when none
has arrived for 15 minutes. Reports are kept 7 days. The body is JSON, 64 KB at most,
in the shape The Conts' `GET /api/system/health` already returns (`measureHealth` in
Conts-ERP `functions/_lib/systemHealth.ts`, sent by its cron worker's
`hubHealthReport`). Every field is optional except `ok`; anything else is dropped.

```json
{
  "ok": true,
  "time": "2026-10-21T04:00:00Z",
  "published_at": "2026-10-20T09:12:00Z",
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

- `ok` false means something needs attention.
- `status` is `ok`, `warning`, `critical` or `off`.
- `published_at` is when the running version was published.
- `storage` may be sent instead of `r2`.
- Never put a password, key or personal data beyond what the system's own health page
  shows.

The answer is `201 { ok: true }`, or 401 for a wrong key. When `RESEND_API_KEY` is set,
the hub emails `HEALTH_ALERT_TO` when a system goes down (two failed checks in a row),
stops sending its report, or its report shows a failed database, failed storage or a
`critical` check. Warnings send no email.

### AI usage: `POST /ai-usage`

A system sends its own daily AI cost estimate per company and module. 256 KB, 40 days
and 500 rows per day at most. Each day sent replaces that day for the sender, so
re-sending the last week is safe. A company whose code is a billing system (e.g.
`2990`) counts for that system; any other company counts for the sender.

```json
{ "vendor": "Anthropic",
  "days": [{ "day": "2026-10-27",
             "rows": [{ "company": "HOUZS", "module": "scan_so", "usd": 1.23, "calls": 40 }] }] }
```

### Usage costs: `POST /usage-costs`

A system sends a vendor's real cost per company for whole months. Houzs Connect sends
Meta's WhatsApp charges this way. 64 KB, 13 months and 100 rows per month at most.
Each month sent replaces that month for the sender, so re-sending this month every day
is safe. IT picks each company's system once on the Overview; a `code` that is a
billing system is picked automatically.

```json
{ "vendor": "Meta (WhatsApp Business)", "currency": "MYR",
  "months": [{ "month": "2026-11",
               "rows": [{ "id": "<company id>", "name": "Hookka", "code": null, "cost": 47.1 }] }] }
```

## One-off scripts

In `backend/scripts`, against `DATABASE_URL`, dry run unless `--apply`:

- `import-sheet.mjs`: imports the old Google Form responses as tickets.
- `bind-reporters.mjs`: links those imported tickets to the reporter's real user id
  in their system.
- `import-accounts.mjs`, `import-billing.mjs`: load the old card register sheet (see
  Finance pages).

Each script's usage is at the top of its file.
