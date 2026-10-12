import { useState, type FormEvent } from "react";
import { api, json } from "../api/client";
import { useHub } from "../components/Layout";

const MIN_PASSWORD = 10;

export default function AccountPage() {
  const { me } = useHub();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return setMsg({ ok: false, text: "The two new passwords do not match" });
    setBusy(true);
    try {
      await api("/me/password", json("POST", { current, next }));
      setMsg({ ok: true, text: "Password changed. Use the new one next time you sign in." });
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  }

  const field = (label: string, value: string, set: (v: string) => void, auto: string) => (
    <label className="block">
      <span className="section-title">{label}</span>
      <input
        type="password"
        className="input mt-1 w-full"
        required
        minLength={auto === "new-password" ? MIN_PASSWORD : undefined}
        autoComplete={auto}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <div className="h-full overflow-auto px-8 py-6">
      <div className="eyebrow">IT Hub · Account</div>
      <h1 className="mt-1 text-[24px] font-extrabold tracking-tight text-ink">My account</h1>

      <div className="mt-4 grid max-w-3xl gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="section-title">Signed in as</div>
          <dl className="mt-3 space-y-2 text-[13px]">
            {[
              ["Name", me.name],
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

        <form onSubmit={save} className="card space-y-3 p-5">
          <div className="section-title">Change password</div>
          {field("Current password", current, setCurrent, "current-password")}
          {field(`New password (at least ${MIN_PASSWORD} characters)`, next, setNext, "new-password")}
          {field("New password again", again, setAgain, "new-password")}
          {msg && (
            <p
              role="status"
              className={`rounded-md px-3 py-2 text-[12.5px] font-medium ${
                msg.ok ? "bg-loz-green text-loz-green-ink" : "bg-loz-red text-loz-red-ink"
              }`}
            >
              {msg.text}
            </p>
          )}
          <button className="btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Change password"}
          </button>
        </form>
      </div>
    </div>
  );
}
