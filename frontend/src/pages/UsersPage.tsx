import { Copy, KeyRound, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, json, type Role } from "../api/client";
import { Avatar } from "../components/Bits";
import { useHub } from "../components/Layout";
import { fmtAgo } from "../lib/format";

type User = {
  id: number;
  email: string;
  username: string | null;
  name: string;
  role: Role;
  active: number;
  lockedUntil: string | null;
  lastSeenAt: string | null;
};

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", developer: "Developer" };

function Status({ u }: { u: User }) {
  if (!u.active) return <span className="pill bg-loz-grey text-loz-grey-ink">Off</span>;
  if (u.lockedUntil && u.lockedUntil > new Date().toISOString()) {
    return <span className="pill bg-loz-orange text-loz-orange-ink">Locked</span>;
  }
  return <span className="pill bg-loz-green text-loz-green-ink">Active</span>;
}

export default function UsersPage() {
  const { me } = useHub();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", username: "", name: "", role: "developer" as Role });
  const [busy, setBusy] = useState(false);
  // The one time a temporary password is visible: right after create or reset.
  const [issued, setIssued] = useState<{ who: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    api<{ users: User[] }>("/admin/users")
      .then((d) => setUsers(d.users))
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
    const res = await run(() => api<{ user: User; password: string }>("/admin/users", json("POST", form)));
    if (!res) return;
    show(res.user.username ?? res.user.email, res.password);
    setForm({ email: "", username: "", name: "", role: "developer" });
    setAdding(false);
    load();
  }

  async function patch(u: User, body: Partial<Pick<User, "role" | "active">>) {
    if (await run(() => api(`/admin/users/${u.id}`, json("PATCH", body)))) load();
  }

  async function reset(u: User) {
    if (!confirm(`Make a new password for ${u.name}? Their old password stops working.`)) return;
    const res = await run(() => api<{ password: string }>(`/admin/users/${u.id}/reset-password`, { method: "POST" }));
    if (res) {
      show(u.username ?? u.email, res.password);
      load();
    }
  }

  async function toggle(u: User) {
    if (u.active && !confirm(`Switch off ${u.name}? They are signed out and cannot sign in until switched back on.`)) return;
    await patch(u, { active: u.active ? 0 : 1 });
  }

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">IT Hub · Admin</div>
          <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Users</h1>
        </div>
        {!adding && (
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
          <code className="rounded-md border border-line bg-surface px-3 py-1.5 font-docno text-[14px] text-ink">
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
            <span className="section-title">Email</span>
            <input
              className="input mt-1 w-full"
              type="email"
              required
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
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <option value="developer">Developer: works on tickets</option>
              <option value="admin">Admin: tickets and users</option>
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

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
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
            {!users && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-ink-subtlest">
                  Loading...
                </td>
              </tr>
            )}
            {users?.map((u) => {
              const self = u.id === me.id;
              return (
                <tr key={u.id} className={`border-b border-line-subtle last:border-0 ${u.active ? "" : "opacity-60"}`}>
                  <td className="px-3 py-2.5 pl-4">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} size={28} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink">
                          {u.name} {self && <span className="font-normal text-ink-subtlest">(you)</span>}
                        </div>
                        <div className="truncate font-docno text-[11.5px] text-ink-subtlest">{u.username ?? "no username"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-subtle">{u.email}</td>
                  <td className="w-44 px-3 py-2.5">
                    <select
                      className="inline-select"
                      value={u.role}
                      disabled={self || busy}
                      title={self ? "You cannot change your own role" : undefined}
                      onChange={(e) => patch(u, { role: e.target.value as Role })}
                    >
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="w-24 px-3 py-2.5">
                    <Status u={u} />
                  </td>
                  <td className="w-28 px-3 py-2.5 text-ink-subtle">{u.lastSeenAt ? fmtAgo(u.lastSeenAt) : "Never"}</td>
                  <td className="w-64 px-3 py-2.5 pr-4 text-right">
                    {self ? (
                      <Link to="/account" className="btn-subtle h-8 px-2.5">
                        Change my password
                      </Link>
                    ) : (
                      <>
                        <button className="btn-subtle h-8 px-2.5" disabled={busy} onClick={() => reset(u)}>
                          Reset password
                        </button>
                        <button className="btn-subtle h-8 px-2.5" disabled={busy} onClick={() => toggle(u)}>
                          {u.active ? "Switch off" : "Switch on"}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
