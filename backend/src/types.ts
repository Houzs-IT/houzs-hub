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
export type DevVars = { user: User & { roleName: string; perms: Perm[] } };

export type SysApp = { Bindings: Env; Variables: SysVars };
export type DevApp = { Bindings: Env; Variables: DevVars };
