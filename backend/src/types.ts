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
}

export type SysVars = { systemCode: string; reporterId: string };
// db: the client devAuth opened, reused by the route so a request holds one connection pool, not two.
export type DevVars = { user: User & { roleName: string; perms: Perm[] }; db: DB };

export type SysApp = { Bindings: Env; Variables: SysVars };
export type DevApp = { Bindings: Env; Variables: DevVars };
