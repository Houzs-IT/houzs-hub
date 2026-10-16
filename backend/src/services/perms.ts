// Permissions a role can grant. Adding one here is all it takes to make it a
// switch on the Roles page; then guard its routes with need("<key>").
export const PERMISSIONS = [
  { key: "it", label: "IT tickets", hint: "The IT category: List, Board, My queue and every system's tickets" },
  { key: "delete_tickets", label: "Delete tickets", hint: "Remove a ticket with its comments and files for good, and delete anyone's comment" },
  { key: "users", label: "Manage users", hint: "Add users, reset passwords, switch accounts off" },
  { key: "roles", label: "Manage roles", hint: "Create and rename roles, set permissions, assign roles and overrides" },
  { key: "integrations", label: "See Integrations", hint: "Whether each system is connected to the hub" },
] as const;

export type Perm = (typeof PERMISSIONS)[number]["key"];

const KEYS = new Set<string>(PERMISSIONS.map((p) => p.key));

// Stored comma-joined; unknown keys (a permission since removed) are dropped.
export const parsePerms = (s: string | null | undefined): Perm[] =>
  (s ?? "").split(",").filter((k): k is Perm => KEYS.has(k));
export const joinPerms = (list: unknown): string | null =>
  Array.isArray(list) && list.every((k) => typeof k === "string" && KEYS.has(k)) ? [...new Set(list)].join(",") : null;

// The role's permissions, plus the user's allows, minus the user's denies.
export function effective(role: string, allow: string, deny: string): Perm[] {
  const denied = new Set(parsePerms(deny));
  return [...new Set([...parsePerms(role), ...parsePerms(allow)])].filter((p) => !denied.has(p));
}

type Account = { id: number; active: number; role: string; permAllow: string; permDeny: string };

// True if, after the change, no active user could still manage roles: nobody
// could then fix permissions from inside the hub.
export function locksOut(users: Account[], rolePerms: Record<string, string>): boolean {
  return !users.some((u) => u.active && effective(rolePerms[u.role] ?? "", u.permAllow, u.permDeny).includes("roles"));
}
