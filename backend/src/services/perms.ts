// Permissions a role can grant. Adding one here is all it takes to make it a
// switch on the Roles page; then guard its routes with need("<key>").
export const PERMISSIONS = [
  { key: "it", label: "IT tickets", hint: "The IT category: List, Board, My queue and every system's tickets" },
  { key: "notifications", label: "Get notifications", hint: "The bell, the unread count and the new ticket pop-ups and sounds. Needs IT tickets too" },
  { key: "delete_tickets", label: "Delete tickets", hint: "Remove a ticket with its comments and files for good, and delete anyone's comment" },
  { key: "users", label: "Manage users", hint: "Add users, reset passwords, switch accounts off" },
  { key: "roles", label: "Manage roles", hint: "Create and rename roles, set permissions, assign roles and overrides" },
  { key: "integrations", label: "See Integrations", hint: "Whether each system is connected to the hub" },
  { key: "accounts_view", label: "See account ownership", hint: "The Account ownership page under Finance: every outside account and who controls it" },
  { key: "accounts_edit", label: "Edit account ownership", hint: "Add, change and remove accounts on the Account ownership page" },
  { key: "billing_view", label: "See system billing", hint: "The System billing pages under Finance: what each service costs and which card pays" },
  { key: "billing_edit", label: "Edit system billing", hint: "Add, change and remove charges, cards and statement lines under System billing" },
  { key: "health_view", label: "See system health", hint: "The System health page: whether each system is up, how fast and which version" },
  { key: "health_edit", label: "Edit system health", hint: "Add, change and remove the systems the hub checks, and run a check now" },
] as const;

export type Perm = (typeof PERMISSIONS)[number]["key"];

const KEYS = new Set<string>(PERMISSIONS.map((p) => p.key));

// Stored comma-joined; unknown keys (a permission since removed) are dropped.
export const parsePerms = (s: string | null | undefined): Perm[] =>
  (s ?? "").split(",").filter((k): k is Perm => KEYS.has(k));
export const joinPerms = (list: unknown): string | null =>
  Array.isArray(list) && list.every((k) => typeof k === "string" && KEYS.has(k)) ? [...new Set(list)].join(",") : null;

// All the user's roles' permissions, plus the user's allows, minus the user's denies.
export function effective(rolePermissions: string[], allow: string, deny: string): Perm[] {
  const denied = new Set(parsePerms(deny));
  return [...new Set([...rolePermissions.flatMap(parsePerms), ...parsePerms(allow)])].filter((p) => !denied.has(p));
}

export interface Account { id: number; active: number; roles: string[]; permAllow: string; permDeny: string }

// True if, after the change, no active user could still manage roles: nobody
// could then fix permissions from inside the hub.
export function locksOut(users: Account[], rolePerms: Record<string, string>): boolean {
  return !users.some(
    (user) =>
      user.active &&
      effective(user.roles.map((role) => rolePerms[role] ?? ""), user.permAllow, user.permDeny).includes("roles"),
  );
}
