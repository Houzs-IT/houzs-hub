import PasswordForm from "../components/PasswordForm";

// Shown by Layout instead of the app while the account still has a password an
// admin handed out. The server refuses everything else until this is done.
export default function FirstPasswordPage({ name }: { name: string }) {
  return (
    <div className="grid min-h-full place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-sidebar text-[13px] font-bold tracking-wider text-accent-bright shadow-[inset_0_0_0_1px_rgba(161,106,46,0.35)]">
            HH
          </span>
          <div>
            <div className="text-[16px] font-bold text-ink">Houzs Hub</div>
            <div className="text-[9.5px] font-bold uppercase tracking-brand text-accent">ENTERPRISE PORTAL</div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6 shadow-stone">
          <h1 className="text-[18px] font-bold text-ink">Welcome, {name}</h1>
          <p className="mb-5 mt-1 text-[13px] text-ink-subtle">
            Choose your own password. The one you were given stops working, and nobody else will know the new one.
          </p>
          <PasswordForm
            currentLabel="Password you were given"
            submitLabel="Save and continue"
            onDone={() => location.reload()}
          />
        </div>

        <button
          className="tap mt-4 w-full text-center text-[12px] text-ink-subtle hover:text-ink"
          onClick={() => fetch("/api/v1/auth/logout", { method: "POST" }).finally(() => location.assign("/login"))}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
