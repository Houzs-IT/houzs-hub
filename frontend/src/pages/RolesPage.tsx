import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, json, type Perm, type PermDef, type RoleRow } from "../api/client";

function RoleName({ role, busy, onSave }: { role: RoleRow; busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState(role.name);
  useEffect(() => setName(role.name), [role.name]);
  const save = () => {
    const next = name.trim();
    if (next && next !== role.name) onSave(next);
    else setName(role.name);
  };
  return (
    <input
      className="input h-8 w-full max-w-[14rem] font-semibold"
      value={name}
      maxLength={40}
      disabled={busy}
      aria-label={`Name of ${role.name}`}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [defs, setDefs] = useState<PermDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(() => {
    api<{ roles: RoleRow[]; permissions: PermDef[] }>("/admin/roles")
      .then((d) => {
        setRoles(d.roles);
        setDefs(d.permissions);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  }

  const patch = (r: RoleRow, body: { name?: string; permissions?: Perm[] }) =>
    run(() => api(`/admin/roles/${encodeURIComponent(r.key)}`, json("PATCH", body)));

  const toggle = (r: RoleRow, p: Perm) =>
    patch(r, { permissions: r.permissions.includes(p) ? r.permissions.filter((x) => x !== p) : [...r.permissions, p] });

  function add(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    run(() => api("/admin/roles", json("POST", { name: newName.trim() }))).then(() => setNewName(""));
  }

  function remove(r: RoleRow) {
    if (confirm(`Delete the role ${r.name}?`)) run(() => api(`/admin/roles/${encodeURIComponent(r.key)}`, { method: "DELETE" }));
  }

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="eyebrow">IT Hub · Admin</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Roles</h1>
      <p className="mt-1 max-w-2xl text-[13px] text-ink-subtle">
        Tick what each role may do. Click a name to rename it. To give one person more or less than their role, use
        Permissions on the Users page.
      </p>

      {error && <div className="mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">{error}</div>}

      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[13px]">
          <thead>
            <tr>
              {["Role", ...defs.map((d) => d.label), "Users", ""].map((h, i) => (
                <th
                  key={i}
                  title={defs[i - 1]?.hint}
                  className="border-b-2 border-line bg-surface-dim px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-brand text-ink-subtle first:rounded-tl-[10px] first:pl-4 last:rounded-tr-[10px]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!roles && !error && (
              <tr>
                <td colSpan={defs.length + 3} className="p-6 text-center text-ink-subtlest">
                  Loading...
                </td>
              </tr>
            )}
            {roles?.map((r) => (
              <tr key={r.key} className="border-b border-line-subtle last:border-0">
                <td className="px-3 py-2 pl-4">
                  <RoleName role={r} busy={busy} onSave={(name) => patch(r, { name })} />
                </td>
                {defs.map((d) => (
                  <td key={d.key} className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[rgb(var(--primary))]"
                      checked={r.permissions.includes(d.key)}
                      disabled={busy}
                      aria-label={`${r.name}: ${d.label}`}
                      onChange={() => toggle(r, d.key)}
                    />
                  </td>
                ))}
                <td className="w-20 px-3 py-2 tabular-nums text-ink-subtle">{r.users}</td>
                <td className="w-16 px-3 py-2 pr-4 text-right">
                  <button
                    className="btn-subtle h-8 px-2"
                    disabled={busy || r.builtIn || r.users > 0}
                    title={r.builtIn ? "Built in, cannot be deleted" : r.users > 0 ? "Move its users to another role first" : "Delete role"}
                    aria-label={`Delete ${r.name}`}
                    onClick={() => remove(r)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="mt-4 flex max-w-md gap-2">
        <input
          className="input flex-1"
          placeholder="New role name, e.g. Support lead"
          maxLength={40}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button className="btn-primary" disabled={busy || !newName.trim()}>
          <Plus className="h-4 w-4" /> Add role
        </button>
      </form>
    </div>
  );
}
