import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
      className="input w-full font-semibold"
      value={name}
      maxLength={40}
      disabled={busy}
      aria-label={`Name of ${role.name}`}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setName(role.name);
          // Blur after the reset lands, so save() sees the original name and does nothing.
          const input = e.currentTarget;
          setTimeout(() => input.blur());
        }
      }}
    />
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [defs, setDefs] = useState<PermDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const confirmDelete = useRef<HTMLDialogElement>(null);

  const load = useCallback(() => {
    api<{ roles: RoleRow[]; permissions: PermDef[] }>("/admin/roles")
      .then((d) => {
        setRoles(d.roles);
        setDefs(d.permissions);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  // Resolves true when the change went through, so callers can keep input on failure.
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
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
    run(() => api("/admin/roles", json("POST", { name: newName.trim() }))).then((ok) => ok && setNewName(""));
  }

  function askToDelete(r: RoleRow) {
    setDeleting(r);
    confirmDelete.current?.showModal();
  }

  function remove() {
    confirmDelete.current?.close();
    if (deleting) run(() => api(`/admin/roles/${encodeURIComponent(deleting.key)}`, { method: "DELETE" }));
  }

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <div className="eyebrow">IT Hub · Admin</div>
          <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">Roles</h1>
          <p className="mt-1 text-[13px] text-ink-subtle">
            Tick what each role may do; changes save as you go. To give one person more or less than their role, use
            Permissions on the Users page.
          </p>
        </div>
        <form onSubmit={add} className="flex w-full gap-2 sm:w-auto">
          <input
            className="input min-w-0 flex-1 sm:w-56"
            placeholder="New role, e.g. Support lead"
            aria-label="New role name"
            maxLength={40}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn-primary" disabled={busy || !newName.trim()}>
            <Plus className="h-4 w-4" /> Add role
          </button>
        </form>
      </div>

      {/* Sticky so a refused change (e.g. removing the last role manager) shows wherever you scrolled to. */}
      {error && (
        <div role="alert" className="sticky top-0 z-10 mt-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink shadow-stone">
          {error}
        </div>
      )}
      <div className="mt-4 text-[11.5px] text-ink-subtlest" aria-live="polite">
        {busy ? "Saving..." : " "}
      </div>

      {!roles && !error && <div className="py-16 text-center text-sm text-ink-subtle">Loading...</div>}
      {!roles && error && (
        <div className="py-8 text-center">
          <button className="btn-default" onClick={load}>
            Try again
          </button>
        </div>
      )}

      <dialog ref={confirmDelete} className="card w-[400px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40">
        <div className="border-b border-line px-5 py-3 text-[15px] font-bold">Delete role</div>
        <p className="px-5 py-4 text-sm leading-6 text-ink-subtle">
          Delete the role <span className="font-semibold text-ink">{deleting?.name}</span>? Nobody has it, and this cannot be undone.
        </p>
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button className="btn-default" autoFocus onClick={() => confirmDelete.current?.close()}>
            Cancel
          </button>
          <button className="btn border border-loz-red-ink bg-loz-red-ink text-surface hover:opacity-90" onClick={remove}>
            Delete
          </button>
        </div>
      </dialog>

      <div className="mt-1 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {roles?.map((r) => (
          <section key={r.key} className="card p-4" aria-label={r.name}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <RoleName role={r} busy={busy} onSave={(name) => patch(r, { name })} />
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                  {r.builtIn && <span className="pill bg-surface-dim text-ink-subtle">Built in</span>}
                  <span className="tabular-nums">
                    {r.users} {r.users === 1 ? "user" : "users"}
                  </span>
                </div>
              </div>
              {!r.builtIn && (
                <button
                  className="btn-subtle px-2"
                  disabled={busy || r.users > 0}
                  aria-label={`Delete ${r.name}`}
                  title="Delete role"
                  onClick={() => askToDelete(r)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <ul className="mt-3 divide-y divide-line-subtle rounded-md border border-line-subtle">
              {defs.map((d) => (
                <li key={d.key}>
                  <label className={`tap flex items-start gap-3 px-3 py-2.5 ${busy ? "cursor-wait" : "cursor-pointer hover:bg-surface-2"}`}>
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--primary))]"
                      checked={r.permissions.includes(d.key)}
                      disabled={busy}
                      onChange={() => toggle(r, d.key)}
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{d.label}</span>
                      <span className="block text-[11.5px] text-ink-subtlest">{d.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {r.builtIn ? (
              <p className="mt-2 text-[11.5px] text-ink-subtlest">Built-in roles can be renamed but not deleted.</p>
            ) : (
              r.users > 0 && (
                <p className="mt-2 text-[11.5px] text-ink-subtlest">
                  Move its {r.users === 1 ? "user" : `${r.users} users`} to another role on the Users page before deleting.
                </p>
              )
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
