import { ChevronDown, Copy, KeyRound, MoreHorizontal, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, json, type Perm, type PermDef, type RoleRow } from "../api/client";
import { Avatar } from "../components/Bits";
import { useOutside } from "../components/FilterButton";
import { useHub } from "../components/Layout";
import { fmtAgo } from "../lib/format";

type UserRow = {
  id: number;
  email: string | null;
  username: string | null;
  name: string;
  role: string;
  permAllow: Perm[];
  permDeny: Perm[];
  active: number;
  lockedUntil: string | null;
  lastSeenAt: string | null;
};

type Override = "inherit" | "allow" | "deny";

// One user's permissions on top of their role: Inherit follows the role,
// Allow adds the permission, Deny takes it away even if the role has it.
function Overrides({ u, role, defs, busy, onSave }: {
  u: UserRow;
  role: RoleRow | undefined;
  defs: PermDef[];
  busy: boolean;
  onSave: (body: { permAllow: Perm[]; permDeny: Perm[] }) => void;
}) {
  const state = (p: Perm): Override => (u.permDeny.includes(p) ? "deny" : u.permAllow.includes(p) ? "allow" : "inherit");
  function set(p: Perm, to: Override) {
    const allow = u.permAllow.filter((x) => x !== p);
    const deny = u.permDeny.filter((x) => x !== p);
    if (to === "allow") allow.push(p);
    if (to === "deny") deny.push(p);
    onSave({ permAllow: allow, permDeny: deny });
  }
  const roleName = role?.name ?? u.role;
  const custom = u.permAllow.length + u.permDeny.length > 0;
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="text-[13px] font-semibold text-ink">Permissions for {u.name}</div>
        <span className="text-[11.5px] text-ink-subtlest">{busy ? "Saving..." : "Changes save automatically"}</span>
        <button
          className="btn-subtle ml-auto h-7 px-2 text-[12px]"
          disabled={busy || !custom}
          onClick={() => onSave({ permAllow: [], permDeny: [] })}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to {roleName}
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-2">
        {defs.map((d) => {
          const fromRole = !!role?.permissions.includes(d.key);
          const st = state(d.key);
          const on = st === "allow" || (st === "inherit" && fromRole);
          return (
            <div key={d.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line-subtle bg-surface px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-loz-green-ink" : "bg-line-strong"}`}
                    title={on ? "Effective: allowed" : "Effective: not allowed"}
                  />
                  <span className="truncate">{d.label}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-ink-subtlest">
                  {st === "inherit" ? `Inherited from ${roleName}` : "Custom override"}
                </div>
              </div>
              <div className="inline-flex shrink-0 rounded-md bg-surface-2 p-0.5" role="radiogroup" aria-label={d.label}>
                {(["inherit", "allow", "deny"] as const).map((o) => (
                  <button
                    key={o}
                    role="radio"
                    aria-checked={st === o}
                    disabled={busy}
                    onClick={() => st !== o && set(d.key, o)}
                    className={`tap h-6 rounded px-2 text-[12px] capitalize transition-colors disabled:cursor-not-allowed ${
                      st === o
                        ? o === "deny"
                          ? "bg-loz-red font-semibold text-loz-red-ink"
                          : o === "allow"
                            ? "bg-loz-green font-semibold text-loz-green-ink"
                            : "bg-surface font-semibold text-ink shadow-sm"
                        : "text-ink-subtle hover:text-ink"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Fixed position so the table's overflow-x-auto card does not clip the menu.
function RowMenu({ items, disabled }: { items: { label: string; danger?: boolean; onClick: () => void }[]; disabled?: boolean }) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  const ref = useOutside<HTMLDivElement>(!!at, close);
  useEffect(() => {
    if (!at) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at, close]);
  return (
    <div ref={ref} className="inline-block">
      <button
        className="tap btn-subtle h-8 w-8 px-0"
        aria-label="More actions"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          if (at) return close();
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {at && (
        <div role="menu" style={at} className="fixed z-30 min-w-[180px] rounded-[10px] border border-transparent bg-overlay py-1.5 text-left shadow-overlay">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`tap flex w-full items-center px-3 py-1.5 text-[13px] hover:bg-primary-soft ${it.danger ? "text-loz-red-ink" : "text-ink"}`}
              onClick={() => {
                close();
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Status({ u }: { u: UserRow }) {
  if (!u.active) return <span className="pill bg-loz-grey text-loz-grey-ink">Inactive</span>;
  if (u.lockedUntil && u.lockedUntil > new Date().toISOString()) {
    return <span className="pill bg-loz-orange text-loz-orange-ink">Locked</span>;
  }
  return <span className="pill bg-loz-green text-loz-green-ink">Active</span>;
}

export default function UsersPage() {
  const { me } = useHub();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", username: "", name: "", role: "developer" });
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [defs, setDefs] = useState<PermDef[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const canUsers = !!me.perms?.includes("users");
  const canRoles = !!me.perms?.includes("roles");
  const [busy, setBusy] = useState(false);
  // The one time a temporary password is visible: right after create or reset.
  const [issued, setIssued] = useState<{ who: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api<{ users: UserRow[] }>("/admin/users")
      .then((d) => setUsers(d.users))
      .catch((e: Error) => setError(e.message));
    api<{ roles: RoleRow[]; permissions: PermDef[] }>("/admin/roles")
      .then((d) => {
        setRoles(d.roles);
        setDefs(d.permissions);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function show(who: string, password: string) {
    setCopied(false);
    setIssued({ who, password });
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const res = await run(() => api<{ user: UserRow; password: string }>("/admin/users", json("POST", form)));
    if (!res) return;
    show(res.user.username ?? res.user.email ?? res.user.name, res.password);
    setForm({ email: "", username: "", name: "", role: "developer" });
    setAdding(false);
    load();
  }

  async function patch(u: UserRow, body: Partial<Pick<UserRow, "role" | "active" | "permAllow" | "permDeny">>) {
    if (await run(() => api(`/admin/users/${u.id}`, json("PATCH", body)))) load();
  }

  async function reset(u: UserRow) {
    if (!confirm(`Make a new password for ${u.name}? Their old password stops working.`)) return;
    const res = await run(() => api<{ password: string }>(`/admin/users/${u.id}/reset-password`, { method: "POST" }));
    if (res) {
      show(u.username ?? u.email ?? u.name, res.password);
      load();
    }
  }

  async function toggle(u: UserRow) {
    if (u.active && !confirm(`Deactivate ${u.name}? They are signed out and cannot sign in until reactivated.`)) return;
    await patch(u, { active: u.active ? 0 : 1 });
  }

  // Shared by the phone/tablet cards and the wide-screen table.
  function roleSelect(u: UserRow, className: string) {
    const self = u.id === me.id;
    return (
      <select
        className={className}
        value={u.role}
        disabled={self || busy || !canRoles}
        title={self ? "You cannot change your own role" : !canRoles ? "Needs the Manage roles permission" : undefined}
        aria-label={`Role for ${u.name}`}
        onChange={(e) => patch(u, { role: e.target.value })}
      >
        {roles.map((r) => (
          <option key={r.key} value={r.key}>
            {r.name}
          </option>
        ))}
      </select>
    );
  }

  function overridesNote(u: UserRow) {
    const count = u.permAllow.length + u.permDeny.length;
    return count > 0 && <div className="mt-0.5 text-[11px] text-ink-subtlest">{count} override{count > 1 ? "s" : ""}</div>;
  }

  function permissionsButton(u: UserRow) {
    return (
      canRoles && (
        <button
          className={`h-8 px-2.5 ${open === u.id ? "btn-default" : "btn-subtle"}`}
          aria-expanded={open === u.id}
          onClick={() => setOpen(open === u.id ? null : u.id)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Permissions
          <ChevronDown className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open === u.id ? "rotate-180" : ""}`} />
        </button>
      )
    );
  }

  function rowMenu(u: UserRow) {
    return (
      canUsers && (
        <RowMenu
          disabled={busy}
          items={[
            { label: "Reset password", onClick: () => reset(u) },
            u.active
              ? { label: "Deactivate user", danger: true, onClick: () => toggle(u) }
              : { label: "Reactivate user", onClick: () => toggle(u) },
          ]}
        />
      )
    );
  }

  function overrides(u: UserRow) {
    return (
      <Overrides u={u} role={roles.find((r) => r.key === u.role)} defs={defs} busy={busy} onSave={(body) => patch(u, body)} />
    );
  }

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">IT Hub · Admin</div>
          <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Users</h1>
        </div>
        {!adding && canUsers && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add user
          </button>
        )}
      </div>

      {error && <div className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">{error}</div>}

      {issued && (
        <div className="card mt-4 flex flex-wrap items-center gap-3 border-primary/40 bg-primary-soft p-4">
          <KeyRound className="h-5 w-5 text-primary" />
          <div className="min-w-[14rem] flex-1">
            <div className="text-[13px] font-semibold text-primary-ink">Password for {issued.who}</div>
            <div className="text-[12px] text-ink-subtle">
              Shown only once. Send it to them privately; they can change it on their Account page.
            </div>
          </div>
          <code className="break-all rounded-md border border-line bg-surface px-3 py-1.5 font-docno text-[14px] text-ink">
            {issued.password}
          </code>
          <button
            className="btn-default"
            onClick={() => navigator.clipboard.writeText(issued.password).then(() => setCopied(true))}
          >
            <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn-subtle px-2" title="Hide" aria-label="Hide password" onClick={() => setIssued(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {adding && (
        <form onSubmit={add} className="card mt-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="section-title">Email (optional)</span>
            <input
              className="input mt-1 w-full"
              type="email"
              autoFocus
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="section-title">Username</span>
            <input
              className="input mt-1 w-full"
              required
              pattern="[a-zA-Z0-9._\-]{2,32}"
              title="2 to 32 letters, numbers, dot, dash or underscore"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="section-title">Display name</span>
            <input
              className="input mt-1 w-full"
              placeholder="Defaults to username"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="section-title">Role</span>
            <select
              className="input mt-1 w-full"
              value={form.role}
              disabled={!canRoles}
              title={canRoles ? undefined : "Only someone who can manage roles can pick another role"}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button className="btn-primary" disabled={busy}>
              Create and show password
            </button>
            <button type="button" className="btn-subtle" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!users && !error && <div className="py-16 text-center text-sm text-ink-subtlest">Loading...</div>}

      {/* Below 1280px each user is a card, so nothing scrolls sideways and Permissions opens full width. */}
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:hidden">
        {users?.map((u) => {
          const self = u.id === me.id;
          return (
            <div key={u.id} className={`card p-4 ${open === u.id ? "md:col-span-2" : ""}`}>
              <div className={`flex items-start gap-3 ${u.active ? "" : "opacity-60"}`}>
                <Avatar name={u.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium text-ink">{u.name}</span>
                    {self && <span className="text-[13px] text-ink-subtlest">(you)</span>}
                    <Status u={u} />
                  </div>
                  <div className="truncate text-xs text-ink-subtlest">
                    {u.username ? `@${u.username}` : "no username"}
                    {u.email && ` · ${u.email}`}
                  </div>
                  <div className="text-xs text-ink-subtlest">Last seen {u.lastSeenAt ? fmtAgo(u.lastSeenAt) : "never"}</div>
                </div>
                {!self && rowMenu(u)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  {roleSelect(u, "input w-full")}
                  {overridesNote(u)}
                </div>
                {self ? (
                  <Link to="/account" className="btn-subtle h-8 px-2.5">
                    Change my password
                  </Link>
                ) : (
                  permissionsButton(u)
                )}
              </div>
              {open === u.id && !self && <div className="mt-3">{overrides(u)}</div>}
            </div>
          );
        })}
      </div>

      <div className="card mt-4 hidden overflow-x-auto xl:block">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {["User", "Email", "Role", "Status", "Last seen", ""].map((h, i) => (
                <th
                  key={i}
                  className="border-b-2 border-line bg-surface-dim px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:rounded-tl-[10px] first:pl-4 last:rounded-tr-[10px]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => {
              const self = u.id === me.id;
              return (
                <Fragment key={u.id}>
                  <tr className={`border-b border-line-subtle last:border-0 ${u.active ? "" : "opacity-60"}`}>
                    <td className="px-3 py-2.5 pl-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size={28} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">
                            {u.name} {self && <span className="font-normal text-ink-subtlest">(you)</span>}
                          </div>
                          <div className="truncate text-xs text-ink-subtlest">{u.username ? `@${u.username}` : "no username"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-ink-subtle">
                      <div className="max-w-[16rem] truncate" title={u.email ?? undefined}>
                        {u.email || <span className="text-ink-subtlest">—</span>}
                      </div>
                    </td>
                    <td className="w-44 px-3 py-2.5">
                      {roleSelect(u, "inline-select")}
                      {overridesNote(u)}
                    </td>
                    <td className="w-24 px-3 py-2.5">
                      <Status u={u} />
                    </td>
                    <td className="w-28 px-3 py-2.5 text-ink-subtle">{u.lastSeenAt ? fmtAgo(u.lastSeenAt) : "Never"}</td>
                    <td className="w-56 px-3 py-2.5 pr-4">
                      <div className="flex items-center justify-end gap-1">
                        {self ? (
                          <Link to="/account" className="btn-subtle h-8 px-2.5">
                            Change my password
                          </Link>
                        ) : (
                          <>
                            {permissionsButton(u)}
                            {rowMenu(u)}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {open === u.id && !self && (
                    <tr className="border-b border-line-subtle">
                      <td colSpan={6} className="px-4 py-3">
                        {overrides(u)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
