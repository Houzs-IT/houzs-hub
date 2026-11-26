# Unifying the group's systems

Owner's goal (2026-11-26): what the systems each built separately becomes one thing, and what they each keep
by hand stays in step. The model is what already works: meeting rooms and IT Support live once in this hub,
and every system calls it.

Systems: Houzs ERP (Houzs-Century/Houzs-ERP), Hookka (Houzs-IT/hookka-erp-testing), Carres
(Houzs-IT/Carres-Portal-v2, `engine/` is a copy of Houzs ERP), Conts (Houzs-IT/Conts-ERP, `engine/` likewise),
HRIS (hello-houzs/Houzs-HRIS), this hub.

## Measured starting point (2026-11-26)

- Carres `engine/`: 5,714 of its 5,828 source paths also exist in Houzs ERP, but in a 145-file sample of
  shared files only 28 were still identical. Conts: 14 of 108. Fixes made in one copy do not reach the others.
- Mail Sync runs in Houzs, Hookka and Carres each as their own GitHub workflow; GitHub fired the "every
  5 minutes" schedule every 5-9 hours, so mail reached the Mail Centers hours late.
- The Meetings page is copied into 5 systems; changing one sentence on it took 4 PRs (Houzs-ERP#6066 and the
  same change in Hookka, Carres, Conts) and turned up a Carres copy still titled "Houzs ERP".

## Phases (each one: PR, deploy, observed on production before the next)

| # | What | Done when |
|---|---|---|
| 1 | Hub cron starts every ERP's Mail Sync every 5 minutes (`services/mailSyncKick.ts`) | Mail Sync runs at most ~5 minutes apart in all three repos' Actions history |
| 2 | Conts mail: find how its Mail Center receives mail and bring it under the same schedule | A test mail to a Conts address shows in its Mail Center within ~10 minutes |
| 3 | Shared modules: one source for the Meetings page, then the IT Support button, kept here and copied into each ERP by a script that opens the PRs; CI in each ERP fails if its copy drifts | A change made once reaches all ERPs by those PRs |
| 4 | AI Connector: one shared core for the tools every system has (search, daily brief, propose email or meeting) | Each system's connector imports the core |
| 5 | Staff: HRIS is the one employee list; joiners and leavers reach every ERP's user list and mailbox | A leaver marked in HRIS is disabled in every ERP |
| 6 | Port the fixes Houzs made since Carres and Conts were copied, highest value first, starting with prints (Houzs-ERP#6041) | A list of ported and deliberately skipped fixes |
| 7 | Mail Center, announcements, permissions and login: decide per module whether to share or keep separate | Decision recorded here per module |

Merging Carres and Conts back into one Houzs codebase is not planned: months of work with high risk; phases 3
to 6 take most of the benefit.
