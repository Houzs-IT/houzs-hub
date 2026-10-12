# Houzs IT Hub — TODO

Source ticket: DEV-35 "To Create Centralise IT system" (reporter Lim, High).
Phase 1 = ticketing only. System Health / Dashboard / AI usage billing come later on the same hub.

## Decisions (confirmed 2026-10-08)

- Hub is a new repo + new Worker: Hono + Supabase Postgres via Hyperdrive + R2 (database changed from D1 on 2026-10-12 so developers can be given access to the hub's data alone).
- Developer login: own `/login` page, username or email + password (changed 2026-10-12,
  replaces the earlier Cloudflare Access plan). Accounts and resets via
  `scripts/set-password.mjs`; no sign-up page. Signed HttpOnly session cookie, 7 days.
- Two-way messages: public replies (reporter sees) + internal notes (devs only).
- First system to integrate: Hookka (staging first, then prod).
- Systems call the hub server-to-server with a per-system API key. Reporter identity
  comes from the calling system's session, never from the browser.
- Ticket code: `<SYS>-<0000>` per system: `HK-0001` Hookka, `HC-0001` Houzs Century, `2990-0001` 2990s, `CONTS-0001` Conts. Type (Bug / Development / ...)
  is its own column, not in the code. Imported Sheet rows keep their old id in `legacy_code`.
- Module name inside each system: "IT Support" (not "Service" — ERP-Houzs already uses
  Service for ASSR `/assr`, `service_cases.*`).

## Open questions

- [ ] Domain for the hub — later (suggestion: `hub.it-houzs.dev`).
- [ ] Accounts for Samuel, YH, Laphii, Zaim (need their emails) via `user:set`.
- [ ] Change-password page (for now the script resets it).
- [ ] 2990s stack — no local repo yet.
- [ ] SLA hours per priority (Urgent / High / Medium / Low).

## 1. Hub backend — done 2026-10-08 (local), not deployed

- [x] Scaffold: Worker + Hono + Drizzle + D1 + R2; SPA served as Workers static assets
- [x] 001_init.sql: systems, ticket_sequences, developers, tickets, ticket_events, ticket_attachments
- [x] 002_systems.sql: HK, HC, 2990; 003_conts_system.sql: CONTS (2026-10-12)
- [x] `scripts/issue-api-key.mjs`, `scripts/migrate.mjs` (against `DATABASE_URL`)
- [x] `systemAuth` (Bearer key hash + X-Reporter-Id), `devAuth` (session cookie; was Access JWT until 2026-10-12)
- [x] System API: create / list / unread-count / detail / replies / confirm / attachments
- [x] Dev API: list + stats / detail / pickup / patch / comments (public | internal, optional status) / attachments
- [x] Statuses follow the Sheet: Open, On Going, On Hold, Testing, Waiting Reporter, Done, Closed, Rejected
- [x] Types follow the Sheet: Bug, Development
- [x] Cron: Done -> Closed after 7 days

## 2. Developer portal — done 2026-10-08 (local)

- [x] Ticket list: status tabs with counts, system / type / priority / assignee / search in URL, inline Pick up, SLA
- [x] Ticket detail: timeline, Pick up, status / assignee / priority / type, reply vs internal note, files, "and set status"
- [x] My queue
- [x] Polling (list 30 s, detail 15 s, paused when tab hidden)
- [x] Browser-tested locally end to end with sys API calls as the reporter
- [ ] Systems admin page (rotate key) — CLI script covers it for now

## 2b. Portal UI redo, Jira style — done 2026-10-08 (local)

- [x] Atlassian-like tokens: neutral surface, #172B4D text, blue primary, uppercase status lozenges
- [x] Left sidebar: List / Board / My queue, Systems shortcuts with counts
- [x] Toolbar: search + multi-select filter buttons (System, Type, Status, Priority, Assignee), Clear filters
- [x] List: dense rows, type icon, key, summary, status lozenge, priority icon, assignee avatar, sortable columns
- [x] Board: Kanban columns Open / On Going / On Hold / Testing / Waiting Reporter / Done, drag card to change status
- [x] Issue side panel from list + board (`?selected=HK-0001`), full page at `/tickets/:code`
- [x] Issue view: status button, Assign to me, Details box, Description, Activity tabs (All / Comments / History),
      comment box with "Reply to reporter" / "Add internal note"
- [x] Backend: comma-list filters for system / type / priority / assignee, `sort` + `dir`, `page_size` up to 500

## 2c. Re-theme to Houzs Century "Theme C · Ink & Petrol" — done 2026-10-08 (local; boss: match HC + Connect)

Source: Houzs-Century-ERP `frontend/tailwind.config.js` + `vendor/design-system/tokens.css`
(Connect "Ink Orbit" is the same family; its globals.css says not to copy its own values).

- [x] Tokens: canvas #eef0ec, surface #fff, surface-2 #f4f6f3, surface-dim #e3e6e0, border #d6d9d2,
      ink #11140f / #414539 / #767b6e, primary petrol #16695f (soft #e1efed, ink #0c3f39),
      brass accent #a16a2e (bright #d8a85a) for logo / ticket codes / eyebrows only
- [x] Dark ink-green sidebar #13201c, active = petrol 22% + 2px petrol bar, brass edge line
- [x] IBM Plex Sans body, IBM Plex Mono ticket codes
- [x] Century Badge (rounded-full, uppercase, bold, soft tone) for statuses; Century Button sizes
- [x] Table in a white card, header on surface-dim, uppercase tracking-brand labels
- [x] Dark mode kept as an Ink & Petrol dark variant (neither HC nor Connect has one); default light

## 3. Hookka "IT Support" module

Hookka is Workers + Supabase; main checkout `.dev.vars` points at PROD — develop against
staging (`hookka-erp-staging-sg`), feature PR goes to staging first.

- [ ] Read Hookka `docs/CODEBASE-MAP.md`, `docs/PLAYBOOKS.md`, `HOOKKA-GOTCHAS.md`, RBAC doc first
- [ ] Secrets: `IT_HUB_URL`, `IT_HUB_API_KEY` (staging + prod)
- [ ] Backend proxy routes `src/api/routes/it-support.ts` — fills reporter fields from the
      session user (id, name, email, phone, department), forwards to hub; real RBAC gate
      (not just `getOrgId`)
- [ ] Permission: every logged-in user can create + see own tickets
- [ ] Pages: "Report an issue" form (title, description, type, priority, occurred_at,
      screenshots; page_url + app_version auto), "My tickets" list, ticket detail with replies + Confirm
- [ ] Sidebar entry + unread badge via polling
- [ ] Optional: "Report issue" button in the top bar that pre-fills the current page URL
- [ ] Regenerate `docs/API.md`, run `audit-rbac.mjs`
- [ ] End-to-end test on staging: create in Hookka -> pickup in hub -> reply -> reporter sees -> resolve -> confirm

## 4. Rollout

- [ ] Import Google Sheet history into hub (one-shot script). ~149 rows across tabs Development / Bugs /
      Done. Columns: Developer, Progress, ID, Priority, Type, System, Issue Title, Description,
      Date and Time Issue Occurred, Submit Photo (Drive link), Reporter Name, Contact Number.
      Map Progress: blank -> open, On Going -> in_progress, On Hold, Testing, Done -> closed.
- [ ] Deploy hub prod + `SESSION_SECRET` secret
- [ ] Hookka prod
- [ ] Then Houzs Century, 2990s using Hookka as the template
- [ ] Retire the Google Form

## Later (same hub)

- [ ] System Health — ping each system's health endpoint on cron, status page
- [ ] Dashboard — ticket volume / SLA by system
- [ ] AI usage per system + monthly charges
- [ ] Email / WhatsApp notify on status change
