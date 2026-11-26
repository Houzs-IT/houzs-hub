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
| `GH_DISPATCH_TOKEN_HOUZS_CENTURY` | Optional | Fine-grained GitHub token, owner Houzs-Century, repo Houzs-ERP, Actions: read and write. The 5-minute cron starts that ERP's Mail Sync workflow with it. |
| `GH_DISPATCH_TOKEN_HOUZS_IT` | Optional | Same, owner Houzs-IT, repos hookka-erp-testing and Carres-Portal-v2. |

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

## Meeting rooms

Rooms, meetings, guest booking links and a staff directory shared by every ERP live here;
each ERP shows them on its own Meetings page and calls `/api/v1/sys/meetings/*` server to
server with its hub key. The ERP vouches for the person with `X-Reporter-Id` plus
`X-Person-Name`, `X-Person-Email`, `X-Person-Company`, `X-Person-Department`, and for the
"Manage meeting rooms" permission with `X-Can-Manage-Rooms: 1`. A person is one key across
systems (their email, else `<system>:<id>`). Guest pages are proxied with
`X-Reporter-Id: guest` and may only use `/public/*`.

Every rule lives in `backend/src/services/meetings.ts`: a person or room already booked,
the room's gap between meetings, closed dates, longest booking and how far ahead. A save
holds the room's row (`SELECT ... FOR UPDATE`), so two people taking the same slot at the
same moment get one booking and one refusal. `PUT /directory` takes the ERP's whole staff
list. Check the whole flow locally with `node backend/scripts/meetings-e2e.mjs <HC key> <HK key>`
(add `<IT login> <IT password>` to check IT Support's own page too).

IT Support's own users book on the portal's **Meetings** page (`frontend/src/pages/meetings/`, the
same page files as Houzs ERP's; `kit.tsx` holds the few app pieces it needs). `/api/v1/meetings/*`
(`backend/src/routes/portalMeetings.ts`) runs the same routes as `/api/v1/sys/meetings` with the
session vouching for the person: system `IT`, company `Houzs IT`, department `IT`, room rights from
the `meeting_rooms` permission on the Roles page. Headers the browser sends are dropped. Opening the
page puts every active portal user in the directory, so the ERPs can invite them. A guest link made
here opens at `/book/:code` on the portal and books through `/api/v1/public/meetings/*`.

Guest links: the person with the link picks the day, the room and the time range (`GET /public/links/:code`
gives the link's rooms and our company / department names; `GET /public/links/:code/day?day=` gives each
room's taken times with no titles or people; `POST .../book` takes `roomId`, `start`, `end`, `title`,
`people`, company and department). `length_min` is the longest booking; hosts are only the people told
and may be empty; `audience` is `anyone` or `staff` (company must be one of ours). A link created with no rooms,
days or hours (the portals' dialog sends none) offers every room, rooms added later included, each
within its own opening days and hours, which a guest cannot book outside. The older fixed-length
`/slots` shape still works for pages not yet updated.

## AI Connector (MCP)

IT staff can ask Claude / ChatGPT about the hub with their own login, read-only.
Connector URL: `https://support.houzscentury.com/api/mcp`. Admin > AI Connector in the portal:
holders of **Manage users** approve people, see every lookup and disconnect anyone.

- OAuth 2.1 (dynamic client registration, PKCE S256, rotating refresh) in `backend/src/routes/mcp.ts`;
  discovery at `/.well-known/oauth-*` (`run_worker_first` in `wrangler.toml`).
- Read-only by construction: a tool call re-enters the app in-process as a GET; `middleware/devAuth.ts`
  accepts an `hbmcp_` token only with the per-isolate `x-hub-mcp-inner` header and only for GET/HEAD,
  then runs the route as the real person (their roles and permissions).
- Never readable: sign-in, the system-key API (`/api/v1/sys`), attachments, live streams.
  Credential-shaped fields are stripped from replies. Tables: migration `023_mcp_connector.sql`.

**Tools, fastest first** (`backend/src/services/mcp-quick.ts` holds the pure summarising code):

| Tool | Reads (as the person, so `need(...)` applies) | Answers |
| --- | --- | --- |
| `ticket_summary {from?, to?, system?}` | `/dev/tickets/report` + `/dev/tickets/stats` | open now by status / system / assignee, new vs resolved in the range, median time to resolve, oldest open, every high-priority open ticket |
| `health_summary` | `/dev/health` | systems down (since when) or slow (> 2000 ms, as on the System health page), 24 h uptime, systems' own reports with problems |
| `search {query}` / `fetch {id}` | `/dev/tickets?q=` / `/dev/tickets/:code` | the shape ChatGPT requires: `{"results":[{id,title,url}]}` and `{id,title,text,url,metadata}`; id = ticket code |
| `tickets_today {system?, overdueDays?}` | `/dev/tickets/report?range=this` | opened today and resolved today by system and category (type, module) with titles; still open by system / type / module / status; urgent (high priority); overdue = open longer than `overdueDays` (default 3) |
| `open_tickets {status?, priority?, system?, type?, assignee?, olderThanDays?}` | `/dev/tickets` (oldest first, 200) | counts by status / priority / system / age / assignee, the 10 oldest |
| `my_tickets` | `/dev/tickets?assignee=me&status=active` | my active tickets, most urgent first |
| `meetings_today {date?}` | `/meetings/mine` + `/meetings/calendar` | my meetings that day and every room booking (rooms by id) |
| `daily_brief` | 4 reads in parallel: my tickets, unassigned high-priority tickets, `/meetings/mine`, unread `/dev/notifications` | what is mine today; a part the person may not read says "you do not have access" and the rest still answers |
| `export_excel {list: "tickets", status?, priority?, system?, type?, assignee?, q?, from?, to?, fields?}` | `/dev/tickets`, paged 200 at a time, newest first | an .xlsx (`services/xlsx.ts`, no dependency) in R2 under `mcp-exports/`, a download link valid 15 minutes (`GET /api/mcp/export/:token`), the row count and `truncated` at 5,000 rows |
| `whoami`, `list_modules`, `list_endpoints`, `erp_get {path, query?, fields?}` | any readable GET | the general path; `fields` keeps only the named keys, replies are cut at 30,000 characters |

`ticket_summary` ranges map onto the report's windows: inside this or last month they are exact by day;
longer ranges (up to 12 months back) are counted by whole months, and the reply says so.
Four prompts (`prompts/list`, `prompts/get`) offer ready-made questions in the AI app, `daily-brief`
("What do I need to look at today?") first.

**Round 3 (2026-11-26)** — `services/mcp-round3.ts` (pure, tested in `backend/test/mcp-round3.test.mjs`):

- The hub keeps **no SLA target or due date** on tickets, so "overdue" is always "open longer than N days",
  and every reply that uses it says so. There is **no asset / device register** in the hub, so there is no
  asset tool.
- **Rate limit:** 30 tool calls a minute and 600 a day per person, counted from `mcp_calls` (index
  `mcp_calls_user_created_idx`, migration `024_mcp_calls_rate_limit.sql`, applied by the deploy workflow on
  merge). Over the limit a call returns a normal tool result with `isError` ("Too many requests — wait a
  minute" / "Daily limit reached"); refused calls (status 429) are logged but not counted. `initialize`,
  `tools/list` and prompts are not counted. The admin leak check reads through `readEndpoint`, never
  `callTool`, so it is never limited. The AI Connector page shows the limits as text.
- **Excel download links** are capability links: a random 24-byte token in the URL, whose SHA-256 names the
  R2 object, checked against `expiresAt` (15 minutes) on download. Objects older than a day are swept on the
  next export. Anyone holding the link can download it within those 15 minutes — the same trust as a
  signed URL.
- `meetings_today` and `daily_brief` read `/api/v1/meetings/mine` and `/calendar`, which (like the Meetings
  page itself) refresh the person's own row in `meeting_people` on every read. That is the existing GET's
  behaviour, not something the connector adds.

**FAQ (owner's acceptance list, 2026-11-26)** — each question is one tool call:

| # | Question | Tool |
| --- | --- | --- |
| I1 | What problems came in today, and by which system? | `tickets_today` (opened / resolved today by system and category, with titles) |
| I2 | Which tickets are overdue or urgent? Which are mine? | `tickets_today` (urgent + overdue), `open_tickets {olderThanDays}`, `my_tickets`. No SLA target exists: overdue = open longer than N days |
| I3 | What meetings / room bookings are there today? | `meetings_today` |
| E1 | What do I need to look at today? | `daily_brief` (prompt `daily-brief`) |
| E2 | Export X to Excel | `export_excel {list: "tickets", ...}` |

**Speed.** One token check per lookup: the door (`POST /api/mcp`) verifies the token, account and access,
and the tool call's inner GETs reuse that answer for up to 15 s (`services/mcp-inner.ts`
`rememberVerified` / `recallVerified`, per isolate, cleared on Disconnect / Remove in that isolate)
instead of `devAuth` resolving the token and reloading the user again. Every new request is still checked
at the door. The inner GETs also borrow the door's postgres client (`lendDb` / `borrowDb`, keyed by the
Request object), so a lookup opens one connection instead of six. Tests: `npm --prefix backend test`
(`node --test`, Node 22.18+; not part of CI, which runs typecheck + build).
