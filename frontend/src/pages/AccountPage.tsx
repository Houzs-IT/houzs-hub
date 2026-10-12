import { useState, type FormEvent } from "react";
import { api, json, type Developer } from "../api/client";
import { useHub } from "../components/Layout";
import PasswordForm from "../components/PasswordForm";

export default function AccountPage() {
  const { me, setMe } = useHub();
  const [name, setName] = useState(me.name);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [changed, setChanged] = useState(false);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      const res = await api<{ developer: Developer }>("/me", json("PATCH", { name }));
      setMe(res.developer);
      setName(res.developer.name);
      setNameMsg({ ok: true, text: "Display name saved." });
    } catch (err) {
      setNameMsg({ ok: false, text: (err as Error).message });
    }
    setSavingName(false);
  }

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="eyebrow">IT Hub · Account</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">My account</h1>

      <div className="mt-4 grid max-w-3xl gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="section-title">Signed in as</div>
          <form onSubmit={saveName} className="mt-3">
            <label className="block">
              <span className="section-title">Display name</span>
              <div className="mt-1 flex gap-2">
                <input
                  className="input min-w-0 flex-1"
                  required
                  maxLength={60}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameMsg(null);
                  }}
                />
                <button className="btn-primary" disabled={savingName || !name.trim() || name.trim() === me.name}>
                  {savingName ? "Saving..." : "Save"}
                </button>
              </div>
            </label>
            <p className="mt-1 text-[11.5px] text-ink-subtlest">Shown on tickets, comments and the assignee list.</p>
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
              ["Email", me.email],
              ["Role", me.role === "admin" ? "Admin" : "Developer"],
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
