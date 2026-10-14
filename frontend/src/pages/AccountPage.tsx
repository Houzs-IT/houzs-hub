import { useState, type FormEvent } from "react";
import { api, json, type User } from "../api/client";
import { useHub } from "../components/Layout";
import PasswordForm from "../components/PasswordForm";

export default function AccountPage() {
  const { me, setMe } = useHub();
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email ?? "");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const dirty = name.trim() !== me.name || email.trim().toLowerCase() !== (me.email ?? "");
  const [changed, setChanged] = useState(false);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      const res = await api<{ user: User }>("/me", json("PATCH", { name, email }));
      setMe(res.user);
      setName(res.user.name);
      setEmail(res.user.email ?? "");
      setNameMsg({ ok: true, text: "Profile saved." });
    } catch (err) {
      setNameMsg({ ok: false, text: (err as Error).message });
    }
    setSavingName(false);
  }

  return (
    <div className="h-full overflow-auto px-4 py-6 md:px-8">
      <div className="eyebrow">Houzs Hub · Account</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">My account</h1>

      <div className="mt-4 grid max-w-3xl gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="section-title">Profile</div>
          <form onSubmit={saveName} className="mt-3">
            <label className="block">
              <span className="text-[12px] font-semibold text-ink-subtle">Display name</span>
              <input
                className="input mt-1 w-full"
                required
                maxLength={60}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameMsg(null);
                }}
              />
            </label>
            <p className="mt-1 text-[11.5px] text-ink-subtle">Shown on tickets, comments and the assignee list.</p>
            <label className="mt-3 block">
              <span className="text-[12px] font-semibold text-ink-subtle">Email (optional)</span>
              <input
                className="input mt-1 w-full"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setNameMsg(null);
                }}
              />
            </label>
            <p className="mt-1 text-[11.5px] text-ink-subtle">You can also sign in with it. Leave empty to remove it.</p>
            <button className="btn-primary mt-3" disabled={savingName || !name.trim() || !dirty}>
              {savingName ? "Saving..." : "Save"}
            </button>
            {nameMsg && (
              <p
                role="status"
                className={`mt-2 rounded-md px-3 py-2 text-[12.5px] font-medium ${
                  nameMsg.ok ? "bg-loz-green text-loz-green-ink" : "bg-loz-red text-loz-red-ink"
                }`}
              >
                {nameMsg.text}
              </p>
            )}
          </form>
          <dl className="mt-4 space-y-2 border-t border-line-subtle pt-4 text-[13px]">
            {[
              ["Username", me.username ?? "none"],
              ["Role", me.roleName ?? me.role ?? ""],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-20 shrink-0 text-ink-subtlest">{k}</dt>
                <dd className="min-w-0 truncate font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card p-5">
          <div className="section-title mb-3">Change password</div>
          {changed && (
            <p role="status" className="mb-3 rounded-md bg-loz-green px-3 py-2 text-[12.5px] font-medium text-loz-green-ink">
              Password changed. Use the new one next time you sign in.
            </p>
          )}
          <PasswordForm currentLabel="Current password" submitLabel="Change password" onDone={() => setChanged(true)} />
        </div>
      </div>
    </div>
  );
}
