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
  The :00 and :30 runs also send the AI Connector's morning briefs and urgent alerts and, on
  the 1st of the month from 09:00 (GMT+8), build and email the group monthly report.

```
backend/
  src/routes/          API routes (sys*, dev, admin, auth, billing, health, ...)
  src/services/        business rules (tickets, permissions, health, reports, ...);
                       mcp-*.ts = the AI Connector's pure summarising code (round 4: mcp-round4.ts)
                       proactive*.ts, group-*.ts, mcp-client.ts, mailer.ts = round 4d (briefs, alerts, group report)
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
| `RESEND_API_KEY` | Optional | Sends health alert emails to `HEALTH_ALERT_TO` (set in `wrangler.toml`), and the AI Connector's morning briefs, urgent alerts and group monthly report (round 4d). Without it none of those are sent. |
| `ANTHROPIC_ADMIN_KEY` | Optional | Reads Anthropic costs for System billing. |
| `GH_DISPATCH_TOKEN_HOUZS_CENTURY` | Optional | Fine-grained GitHub token, owner Houzs-Century, repo Houzs-ERP, Actions: read and write. The 5-minute cron starts that ERP's Mail Sync workflow with it. |
| `GH_DISPATCH_TOKEN_HOUZS_IT` | Optional | Same, owner Houzs-IT, repos hookka-erp-testing and Carres-Portal-v2. |
| `GROUP_REPORT_KEY` | Optional | The group monthly report (AI Connector round 4d): encrypts the other systems' sign-in tokens (AES-GCM). Any random string of 16+ characters, e.g. `openssl rand -base64 32`. Without it the Group report page says "not configured". Changing it later means connecting every system again. |

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

IT staff can ask Claude / ChatGPT about the hub with their own login. Reads are free; the only changes are
three ticket actions (round 4b), each switched on by an admin and confirmed by the person.
Connector URL: `https://support.houzscentury.com/api/mcp`. Admin > AI Connector in the portal:
holders of **Manage users** approve people, see every lookup and disconnect anyone.

- OAuth 2.1 (dynamic client registration, PKCE S256, rotating refresh) in `backend/src/routes/mcp.ts`;
  discovery at `/.well-known/oauth-*` (`run_worker_first` in `wrangler.toml`).
- Reads by construction: a tool call re-enters the app in-process as a GET; `middleware/devAuth.ts`
  accepts an `hbmcp_` token only with the per-isolate `x-hub-mcp-inner` header and only for GET/HEAD,
  then runs the route as the real person (their roles and permissions). The one exception is a
  confirmed action (round 4b below): one armed, allowlisted write.
- Never readable: sign-in, the system-key API (`/api/v1/sys`), attachments, live streams.
  Credential-shaped fields are stripped from replies. Tables: migration `023_mcp_connector.sql`.

**Tools, fastest first** (`backend/src/services/mcp-quick.ts` holds the pure summarising code):

| Tool | Reads (as the person, so `need(...)` applies) | Answers |
| --- | --- | --- |
| `ticket_summary {period?, from?, to?, system?}` | `/dev/tickets/report` + `/dev/tickets/stats` | open now by status / system / assignee, new vs resolved in the range, median time to resolve, oldest open, every high-priority open ticket |
| `health_summary` | `/dev/health` | systems down (since when) or slow (> 2000 ms, as on the System health page), 24 h uptime, systems' own reports with problems |
| `search {query}` / `fetch {id}` | `/dev/tickets?q=` / `/dev/tickets/:code` | the shape ChatGPT requires: `{"results":[{id,title,url}]}` and `{id,title,text,url,metadata}`; id = ticket code. `fetch` is also the ticket lookup: status, assignee, the whole history |
| `tickets_overdue {system?}` | `/dev/tickets/report?range=this` | past SLA (the Reports page's rule) by system / assignee / priority, most overdue first; every high-priority ticket nobody is assigned to |
| `ticket_digest {period?, from?, to?, system?, limit?}` | `/dev/tickets/digest` twice (this period, and the previous period's count) | tickets raised in the period grouped by system: subject, ~200-character summary, latest comment (trimmed, internal ones marked), status, assignee |
| `data_gaps {system?}` | `/dev/tickets/report`, `/dev/billing`, `/dev/accounts` in parallel | open tickets with no assignee / module; active charges with no amount, card, system, account or check date, or not confirmed; accounts with no main owner / IT access / bills-to |
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

- Tickets keep **no due date**, so in these tools "overdue" is "open longer than N days", and every reply
  that uses it says so. (Round 4 found the Reports page's SLA targets; `tickets_overdue` uses those.) There is **no asset / device register** in the hub, so there is no
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

**Round 4 (2026-11-27)** — `services/mcp-round4.ts` (pure, tested in `backend/test/mcp-round4.test.mjs`):

- **SLA.** Tickets have no due date, but the Reports page has an SLA: high 24 h, medium 3 d, low 7 d from
  submitted to done, not counting time in Waiting Reporter (`frontend/src/lib/labels.ts` `SLA_HOURS`).
  `tickets_overdue` uses exactly that rule on the report's `open_tickets` (imported tickets never count);
  the backend keeps a copy of the targets and a test fails if the two drift. `tickets_today` / `open_tickets`
  still mean "open longer than N days" by "overdue".
- **`period`** (every period-type tool): `today | week | month | last_month | quarter | year | custom`
  (custom needs `from` / `to`, at most 366 days). Malaysia days, inclusive; `week` starts on Monday. The
  previous period is the same span one unit earlier (yesterday; last week to the same weekday; last month to
  the same day, clamped at month end; ...), or for custom the same number of days straight before.
  `ticket_digest` (default `week`) compares the count; `ticket_summary` takes `period` in place of from / to.
- **`GET /api/v1/dev/tickets/digest?from=&to=&system=&limit=`** (new, read-only, `need("it")` like every
  `/tickets/*` route): tickets raised in [from, to) (ISO instants, at most 400 days), newest first, up to
  200, each with `description` and its latest non-empty comment cut to 400 characters. It is the text the
  ticket page already shows to the same role; internal comments are included and marked, as on the page.
  Registered before `/tickets/:code`. The admin leak check probes it like any other list endpoint.
- **No asset register.** The hub keeps no expiry or renewal date for domains, licences, SSL or
  subscriptions (System billing has only a monthly / yearly cycle), so there is no `assets_expiring` tool
  and `data_gaps` says it cannot check "no expiry date".
- **Permissions.** No new rule in the connector: each part reads as the person, and a refused part says
  "You do not have access to X in the hub." The tests run every round-4 tool against a fake hub that
  refuses exactly as the routes do, and pin those `need(...)` guards in the route source.

| Tool | Endpoints | Hub permission that gates it |
| --- | --- | --- |
| `tickets_overdue` | `/dev/tickets/report` | `it` |
| `ticket_digest` | `/dev/tickets/digest` | `it` |
| `data_gaps` | `/dev/tickets/report`, `/dev/billing`, `/dev/accounts` | `it`; `billing_view` or `billing_edit`; `accounts_view` or `accounts_edit` (each part separately) |
| `fetch` (ticket lookup) | `/dev/tickets/:code` | `it` |
| `ticket_summary {period}` | `/dev/tickets/report`, `/dev/tickets/stats` | `it` |

**FAQ (owner's acceptance list, 2026-11-26)** — each question is one tool call:

| # | Question | Tool |
| --- | --- | --- |
| I1 | What problems came in today, and by which system? | `tickets_today` (opened / resolved today by system and category, with titles) |
| I2 | Which tickets are overdue or urgent? Which are mine? | `tickets_overdue` (past SLA by system and assignee, urgent and unassigned), `tickets_today`, `open_tickets {olderThanDays}`, `my_tickets` |
| I3 | What meetings / room bookings are there today? | `meetings_today` |
| E1 | What do I need to look at today? | `daily_brief` (prompt `daily-brief`) |
| E2 | Export X to Excel | `export_excel {list: "tickets", ...}` |
| I4 | What have the recent IT tickets been about? (近期 IT 有什么 ticket，简短) | `ticket_digest {period?: "week", system?}` |
| I5 | Where does ticket HC-0042 stand, who has it, what happened? | `fetch {id: "HC-0042"}` |
| I6 | Which domains / licences / SSL / subscriptions expire soon? | Not available: the hub stores no expiry dates (see Round 4) |
| D4 | What data is missing or needs filling in? | `data_gaps` |
| P | How many tickets this quarter vs last? | `ticket_summary {period: "quarter"}`, `ticket_digest {period: "quarter"}` |

**Round 4b — write actions (owner approved 2026-11-26)** — `backend/src/services/mcp-write-actions.ts`
(pure + an `ActionStore` / `ActionDeps` interface; tests `backend/test/mcp-4bc.test.mjs`).
Same design as Hookka (#1633): `propose_*` validates, stores ONE pending action (single use, 10 minutes,
same token + person) and writes nothing else; the AI shows the summary; `confirm_action` → main switch →
daily cap (30 confirmed actions per person per Malaysia day) → the action's own switch (peeked, so a
switched-off action is refused without using up the id) → single-use claim (`UPDATE … RETURNING`) →
stale check (update only) → the write fence → ONE in-process call to the hub's own route as the person.
`cancel_action` drops a pending action.

| Tool (args) | Hub endpoint (existing) | Body sent (only what the screen sends) | Permission the route checks | Switch |
| --- | --- | --- | --- | --- |
| `propose_ticket {system, title, description?, priority?, type?, reporterName?}` | `POST /api/v1/dev/tickets` (the New ticket dialog) | `system_code, title, description, type, priority, reporter_name` (reporter defaults to the person) | `it` | `action_ticket` |
| `propose_ticket_comment {code, body, visibility?}` | `POST /api/v1/dev/tickets/:code/comments` | `body, visibility` — **internal by default**; `public` (the reporter sees it) is flagged in the summary. No files, no status | `it` | `action_ticket_comment` |
| `propose_ticket_update {code, status?, assignee?}` | `PATCH /api/v1/dev/tickets/:code` (Assignee picker, Status button) | `assignee_id` (me / none / name / id → id or null) and / or `status` (incl. `closed`). Never priority, type or module | `it` | `action_ticket_update` |

- **Fence.** `devAuth.ts` lets an `hbmcp_` token make a non-GET request only when `takeConfirmedAction`
  says yes: `confirm_action` arms exactly one method + path for that token (30 s, one-shot) right after it
  claimed the pending row, and the path must match `ACTION_ALLOWLIST` (the three routes above, `:code` =
  one ticket code). The body is checked against `BODY_KEYS` before arming. Delete (ticket or comment),
  pickup, reorder, billing, accounts, users, roles and health stay unreachable. Checked against the real
  `devAuth` + `need("it")` with a bundled harness: unarmed PATCH 403, armed PATCH 200 once then 403, armed
  DELETE 403, armed path for another ticket 403; without `it` the armed PATCH gets the hub's own
  "You do not have permission for this".
- **Stale check.** `propose_ticket_update` stores the status + assignee the summary showed; confirm re-reads
  the ticket and refuses (409) if either changed in between. Comments and new tickets need no check.
- **Switches.** Admin > AI Connector > "AI actions": "Allow AI actions" (the main switch, `actions_enabled`)
  plus one per action, all **OFF until an admin turns them on** (no row = off; an unreadable table reads as
  off). Only holders of Manage users (the connector admin) can set them: `POST /api/v1/ai-connector/admin/actions
  {key, enabled}`; the connector's own token can never reach that router.
- **Audit.** Every propose / confirm / cancel is a row in `mcp_calls` (target = action + ticket code, never
  the comment or description text; confirm notes `done` / `refused <status>`), shown in the lookups list.
  The route itself writes the ticket's timeline (`ticket_events`: created / comment / assign / status, by
  the person) — the hub's audit trail for tickets; there is no separate audit table. The pending row keeps
  the outcome; its payload is blanked once it ran or was cancelled.
- **Tables:** migration `025_mcp_write_actions.sql` (`mcp_settings`, `mcp_pending_actions`, RLS on, no
  policies). It reaches prod the repo's usual way: the deploy workflow runs `npm --prefix backend run
  db:migrate` on push to `main`, before `wrangler deploy`. Until it has run, the switches read as off.

**Round 4c — platform quality** — `backend/src/services/mcp-visibility.ts` (pure, same test file):

- **P1 role-aware tools/list.** `TOOL_NEEDS` mirrors the routes' guards: ticket tools need `it`;
  `health_summary` `health_view` or `health_edit`; `data_gaps` any of `it` / billing view or edit / accounts
  view or edit; `daily_brief`, `meetings_today`, `whoami`, `list_modules`, `list_endpoints`, `erp_get` for
  everyone (their parts refuse on their own). Write tools are listed only while the main switch and their
  own switch are on and the person holds `it`; `confirm_action` / `cancel_action` while any of them is.
  A hidden read tool called directly answers "You do not have access to this in the hub (… needs the "IT
  tickets" permission)"; a switched-off action answers "… is switched off by your admin".
- **P2 prompts per role:** `it_morning_triage {system?}`, `my_tickets_review`, `it_manager_weekly` (plus the
  four before). A prompt is listed when its first tool is listed for the person.
- **P3 structured output:** the ten quick answers (`ticket_summary`, `tickets_today`, `daily_brief`,
  `open_tickets`, `my_tickets`, `meetings_today`, `health_summary`, `tickets_overdue`, `ticket_digest`,
  `data_gaps`) carry an open `outputSchema` in tools/list and return `structuredContent` (the same JSON as
  the text, which stays).
- **P4 cache:** 60 s per isolate, keyed by person + permissions + tool + arguments, for `ticket_summary`,
  `tickets_today`, `tickets_overdue`, `ticket_digest`, `data_gaps`, `daily_brief`; logged as `cached`; a
  person's entries are dropped when they confirm an action.
- **P5 links:** every quick answer gets `hubLink` (its page: /reports, /tickets, /queue, /meetings,
  /health) and every row with a ticket `code` but no link gets `url` (`/tickets/:code`).

**Untested live (4b / 4c):** every action against prod through a real Claude / ChatGPT client (the unit tests
use an in-memory store and a faked hub that applies the routes' `need("it")`; the fence was run against
the real middleware, not the real database); `structuredContent` against the clients' validators; the
admin switches card (typechecked and built, not rendered — local dev would run on the live database).

**Speed.** One token check per lookup: the door (`POST /api/mcp`) verifies the token, account and access,
and the tool call's inner GETs reuse that answer for up to 15 s (`services/mcp-inner.ts`
`rememberVerified` / `recallVerified`, per isolate, cleared on Disconnect / Remove in that isolate)
instead of `devAuth` resolving the token and reloading the user again. Every new request is still checked
at the door. The inner GETs also borrow the door's postgres client (`lendDb` / `borrowDb`, keyed by the
Request object), so a lookup opens one connection instead of six. Tests: `npm --prefix backend test`
(`node --test`, Node 22.18+; not part of CI, which runs typecheck + build).

**Round 4d — proactive + group** (owner 2026-11-26 「加 全部一起做」)

- **D1 morning brief email.** AI Connector page > "Emails from the AI Connector": opt in (default **off**),
  pick a time on the half hour (default 08:00 Malaysia time) and weekdays or every day. The brief is the
  person's own `daily_brief`, built **as the person**: `routes/proactive.ts` issues a short-lived connector
  token of their own (client `mcpc_morning_brief`, hidden from the connected-apps lists) and revokes it in
  `finally`; the tool runs through `routes/mcp.ts runToolAs`, i.e. the same inner GETs, route permission
  checks and tools/list visibility rule as a question from Claude. There is no service account. Preview (built,
  not sent) and "Send me a test brief" (to your own hub email only, once per 10 minutes) are on the page.
- **D2 urgent alerts** (opt-in, 08:00 to 20:00 Malaysia time, about every 30 minutes, as the person):
  an urgent ticket unassigned for more than 1 hour and a ticket newly past SLA (both from `tickets_overdue`,
  the Reports page's SLA rule), and a system failing its health check (`health_summary`, only for people
  with `health_view`). The alert reads are quiet (`runToolAs {log: false}`): no `mcp_calls` row and no use of
  the person's daily limit, but a tool hidden from them is still refused. **Debounce:** `mcp_proactive_keys`
  (person + key + Malaysia day), claimed before sending, so each alert is emailed at most once a day; the
  brief is a key too, so a second tick never sends a second brief.
- **D4 data gaps.** Monday's brief adds the person's own `data_gaps` (tickets with no assignee / module,
  billing and account blanks), as counts with links; an area they may not read is left out.
- **One config place:** `PROACTIVE_CONFIG` in `backend/src/services/proactive.ts` (pure). The page shows the
  thresholds read-only.
- **Bounded, idempotent tick.** `index.ts scheduled` calls `POST /api/v1/ai-brief/tick` in-process on the
  :00 and :30 runs, with the isolate's MCP inner secret (404 for anyone else). At most 15 briefs and 15 alert
  checks per tick, a 20 s budget, people one at a time; a failed brief gives its claim back for the next tick
  (until 4 hours after its time). Without `RESEND_API_KEY` the tick does nothing and the page says email is
  not set up. Emails go out through Resend (`services/mailer.ts`, the health alerts' key) from
  `BRIEF_MAIL_FROM`.
- **Unsubscribe:** every email has a link with a random token; GET shows one button, POST unsubscribes (a mail
  scanner opening the link changes nothing). The send log `mcp_proactive_sends` never keeps a body.

**D3 group monthly report** — Admin > **Group report** (`/group-report`, holders of **Manage roles**):

- The hub is an **MCP client** of each system's own connector: Hookka `https://erp.hookka.com/api/mcp`,
  Houzs `https://erp.houzscentury.com/api/mcp`, The Conts `https://erp.theconts.com/api/mcp`, HRIS
  `https://api.hris.houzscentury.com/mcp` (`GROUP_SYSTEMS` in `services/group-report.ts`). "Connect" runs that
  system's normal OAuth (`services/mcp-client.ts`: RFC 9728 / 8414 discovery, dynamic client registration as a
  public client named "Houzs IT Hub group report", PKCE S256, its own sign-in and "Allow?" screen) and comes
  back to `/api/v1/group-report/callback`. So every figure comes through **the admin's own grant and his
  permissions in that system**; the hub never reads another system's database.
- **Tokens:** access + refresh tokens AES-GCM sealed with `GROUP_REPORT_KEY` (`services/group-crypto.ts`; the
  additional data binds each value to its system + field), refreshed when under a minute is left or on a 401,
  rotated refresh tokens stored again. Never logged, never returned to the browser.
- **Build:** `company_report` on each connected system via MCP `tools/call`, with each system's own
  arguments for the month: Hookka `{period: "month", month}`; Houzs `{period: "YYYY-MM"}` and again with
  `company: "2990"` for the 2990s; The Conts `{period: "month", month}` and with `company: "Dream Crafter"`;
  HRIS `{period: "YYYY-MM"}` (every company the login sees). One HTML report: the **group summary first**
  (revenue, gross profit, net profit, net cash flow, AR, AP, headcount, each with "vs previous month"; group
  totals over the companies reporting each figure, previous only like for like; headcount not added across
  systems), then one section per company with the same definitions and labels. A system not connected, or
  answering "no access", says so plainly. Definitions are printed at the bottom of every report.
- **Schedule:** the 1st of each month from 09:00 Malaysia time (the first :00 / :30 tick from then), last
  month's report, emailed to the admin(s) who connected the systems. Claimed once per month (unique index); a
  build that throws gives the month back for the next tick. "Build report now" (any month up to this one)
  keeps a copy but does not email. Reports: rows in `group_reports`, the HTML in R2 at
  `group-reports/<id>.html`, viewable on the page (sandboxed, no scripts).
- **Tables:** migration `026_mcp_proactive_group_report.sql` (`mcp_brief_subscriptions`, `mcp_proactive_keys`,
  `mcp_proactive_sends`, `group_report_connections`, `group_report_pending`, `group_reports`; RLS on, no
  policies). It reaches prod the usual way: the deploy workflow runs `npm --prefix backend run db:migrate` on
  push to `main`, before `wrangler deploy`.
- **Tests:** `backend/test/mcp-4d.test.mjs`: opt-in, brief due, tick caps, alert rules, debounce, email HTML
  (escaping), seal / unseal, the report builder with fixture `company_report` answers of every system, the
  schedule, and the MCP client against a stand-in fetch. No system's MCP is called in tests.

**Untested live (4d):** no deploy, no real email sent, no real OAuth round trip with any system. Not yet seen:
the tick firing from the real cron, the brief built through a real token on prod, each system's consent screen
accepting the hub's registration and `resource` parameter, the real `company_report` answers (the builder was
checked against shapes read from each repo's source on 2026-11-27, not against live replies), and the report
email in a real mail client. The report viewer's sandboxed frame was not seen rendering (the preview browser
blocks frames); the same HTML renders standalone.

**Round 5 — process help ("how do I…", owner 2026-11-27)** — `backend/src/services/mcp-howto*.ts` (pure,
no hub data read, tested in `backend/test/mcp-howto.test.mjs`). Same design as the Houzs and Hookka connectors.

- **Tools** (listed for everyone, `TOOL_NEEDS` null; each answer's `canDo` / `canOpen` / `canUse` follows the
  person's own permissions through `PAGE_GATES` in `mcp-howto-types.ts`, which mirrors `Layout.tsx` and each
  route's `need(...)`): `how_to {question | topic}`, `module_overview {module?}`, `glossary {term?}`,
  `explain_error {text}`, `onboarding {role?}` (it-staff, it-manager, admin, finance), `explain_screen {path |
  labels}`, `where_is {thing}`. Prompts: `how_do_i`, `explain_this_error`, `my_first_week`.
- **Guides** (`mcp-howto-guides-tickets.ts`, `mcp-howto-guides-hub.ts`): full SOP per task (purpose,
  prerequisites, who / permission, fields, click-by-click steps with `?highlight=` links, check before, result,
  warnings, undo, approvals, deadlines, common mistakes, worked example, related / next step, contact) and two
  click-by-click flows with who does each step (a ticket from report to closed; a new IT staff member). Every
  business rule cites the line of code that enforces it.
- **Screen map** (`mcp-howto-screens.ts`): every portal page, its parts, buttons and tabs, and the extra
  permission a button needs; used by `explain_screen` and `where_is`.
- **`?highlight=<label>`** (`frontend/src/components/HighlightFromUrl.tsx` + `lib/highlight-match.ts`, mounted in
  `Layout.tsx`): finds the visible element with that label (retries about 3 s), scrolls to it and outlines it in
  gold for about 6 s, then drops the parameter. It never clicks or edits.
- **Gap log:** a question no guide / term / screen / error answers is logged in `mcp_calls` with note `no-guide`
  and a redacted target (emails and long numbers removed, 80 characters); Admin > AI Connector shows them under
  "Questions with no guide yet", most asked first. No names are kept.
- **Honesty tests:** every guide / module / onboarding / screen path exists in `frontend/src/main.tsx`; every
  quoted label, highlight, field, screen action and tab label exists in `frontend/src`; every `explain_error`
  match string still appears in the backend source; related / next-step ids exist; guides are English.
- **Untested live (round 5):** not yet called through a real Claude / ChatGPT client on prod.
