import type { Developer } from "./db/schema";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // Local only (.dev.vars). Honoured only for localhost requests.
  DEV_AUTH_EMAIL?: string;
}

export type SysVars = { systemCode: string; reporterId: string };
export type DevVars = { developer: Developer };

export type SysApp = { Bindings: Env; Variables: SysVars };
export type DevApp = { Bindings: Env; Variables: DevVars };
