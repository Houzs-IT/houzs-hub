import { useState, type FormEvent } from "react";
import { api, json } from "../api/client";

const MIN_PASSWORD = 10;

// Used on My account and on the first sign-in screen (FirstPasswordPage).
export default function PasswordForm({
  currentLabel,
  submitLabel,
  onDone,
}: {
  currentLabel: string;
  submitLabel: string;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return setError("The two new passwords do not match");
    setBusy(true);
    setError(null);
    try {
      await api("/me/password", json("POST", { current, next }));
      setCurrent("");
      setNext("");
      setAgain("");
      onDone();
    } catch (err) {
      setError((err as Error).message);
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
    <form onSubmit={save} className="space-y-3">
      {field(currentLabel, current, setCurrent, "current-password")}
      {field(`New password (at least ${MIN_PASSWORD} characters)`, next, setNext, "new-password")}
      {field("New password again", again, setAgain, "new-password")}
      {error && (
        <p role="alert" className="rounded-md bg-loz-red px-3 py-2 text-[12.5px] font-medium text-loz-red-ink">
          {error}
        </p>
      )}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
