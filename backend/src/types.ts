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
}

export type SysVars = { systemCode: string; reporterId: string };
// db: the client devAuth opened, reused by the route so a request holds one connection pool, not two.
export type DevVars = { user: User & { roles: string[]; roleName: string; perms: Perm[] }; db: DB };

export type SysApp = { Bindings: Env; Variables: SysVars };
export type DevApp = { Bindings: Env; Variables: DevVars };
