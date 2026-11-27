import type { DB } from "./db/client";
import type { User } from "./db/schema";
import type { LiveRoom } from "./live";
import type { Perm } from "./services/perms";

export interface Env {
  HYPERDRIVE: Hyperdrive;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  LIVE: DurableObjectNamespace<LiveRoom>;
  // Signs the session cookie. `wrangler secret put SESSION_SECRET`;
  // locally in .dev.vars.
  SESSION_SECRET?: string;
  // Anthropic Admin API key (sk-ant-admin...) of the company organisation, read-only use:
  // the daily cost report per workspace. `wrangler secret put ANTHROPIC_ADMIN_KEY`.
  ANTHROPIC_ADMIN_KEY?: string;
  // Resend key for the health alert emails. `wrangler secret put RESEND_API_KEY`.
  // No key means no alerts; nothing else depends on it.
  RESEND_API_KEY?: string;
  // Who gets the alerts and who they are from (vars in wrangler.toml).
  HEALTH_ALERT_TO?: string;
  HEALTH_ALERT_FROM?: string;
  // Only for local tests against a stand-in; unset in production.
  ANTHROPIC_ADMIN_BASE_URL?: string;
  // Google Meet links for meetings (services/googleMeet.ts): the service account's JSON key
  // (`wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON`) and the Houzs account the spaces belong to (var).
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  GOOGLE_MEET_OWNER?: string;
  // Only for local tests against a stand-in Google; unset in production.
  GOOGLE_TOKEN_URL?: string;
  GOOGLE_MEET_API_BASE?: string;
  // Meeting emails (services/meetingMail.ts), sent by each ERP's own Mail Center. The sender per system the meeting was
  // made in ({"HK": "Hookka Meetings <hello@hookka.com>", ...}), the fallback sender, and each ERP's address
  // for the "Open in the ERP" button, as {"HC": "https://erp.houzscentury.com", ...} (vars).
  MEETING_MAIL_FROM_BY_SYSTEM?: string;
  MEETING_MAIL_FROM?: string;
  MEETING_ERP_URLS?: string;
  // Where the meeting emails' logos are served (frontend/public/mail); local runs point it at wrangler dev.
  MEETING_LOGO_BASE?: string;
  // AI Connector round 4d: the sender of the brief / alert / group report emails (var; falls back to
  // HEALTH_ALERT_FROM) and the hub's public address for links in them and the OAuth callback (var).
  BRIEF_MAIL_FROM?: string;
  HUB_ORIGIN?: string;
  // Group monthly report (routes/groupReport.ts): the AES-GCM key the systems' OAuth tokens are
  // encrypted with. Any long random string: `wrangler secret put GROUP_REPORT_KEY`. Missing =
  // the feature says "not configured".
  GROUP_REPORT_KEY?: string;
  // GitHub tokens (Actions: write) the cron uses to start each ERP's Mail Sync, per org. `wrangler secret put`.
  GH_DISPATCH_TOKEN_HOUZS_CENTURY?: string;
  GH_DISPATCH_TOKEN_HOUZS_IT?: string;
}

export type SysVars = { systemCode: string; reporterId: string };
// db: the client devAuth opened, reused by the route so a request holds one connection pool, not two.
export type DevUser = User & { roles: string[]; roleName: string; perms: Perm[] };
// viaMcp: the request is the AI Connector's in-process read (routes/mcp.ts), not a browser session.
export type DevVars = { user: DevUser; db: DB; viaMcp?: boolean };

export type SysApp = { Bindings: Env; Variables: SysVars };
export type DevApp = { Bindings: Env; Variables: DevVars };
