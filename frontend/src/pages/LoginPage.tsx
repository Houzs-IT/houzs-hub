import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// Only same-site paths, so ?next= cannot bounce a developer to another site.
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/tickets";
}

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      if (res.ok) return navigate(safeNext(params.get("next")), { replace: true });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `Sign in failed (${res.status})`);
    } catch {
      setError("Cannot reach the server. Check your connection.");
    }
    setBusy(false);
  }

  return (
    <div className="grid min-h-full place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-sidebar text-[13px] font-bold tracking-wider text-accent-bright shadow-[inset_0_0_0_1px_rgba(161,106,46,0.35)]">
            IT
          </span>
          <div>
            <div className="text-[16px] font-bold text-ink">Houzs IT Hub</div>
            <div className="text-[9.5px] font-bold uppercase tracking-brand text-accent">Developer portal</div>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-6 shadow-stone">
          <h1 className="text-[18px] font-bold text-ink">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-subtle">Use your username or email address.</p>

          <label className="mt-5 block text-[12px] font-semibold text-ink-subtle" htmlFor="login">
            Username or email
          </label>
          <input
            id="login"
            className="input mt-1 w-full"
            autoComplete="username"
            autoFocus
            required
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />

          <label className="mt-4 block text-[12px] font-semibold text-ink-subtle" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input mt-1 w-full"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && (
            <p role="alert" className="mt-4 rounded-md bg-loz-red px-3 py-2 text-[12.5px] font-medium text-loz-red-ink">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>

      </div>
    </div>
  );
}
