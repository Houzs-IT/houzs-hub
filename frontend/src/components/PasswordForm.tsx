import { Check, Circle, Eye, EyeOff, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { api, json } from "../api/client";

const MIN_PASSWORD = 10;

// Used on My account and on the first sign-in screen (FirstPasswordPage), which
// leaves out currentLabel: that session already proved the handed-out password.
export default function PasswordForm({
  currentLabel,
  submitLabel,
  onDone,
}: {
  currentLabel?: string;
  submitLabel: string;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isLongEnough = next.length >= MIN_PASSWORD;
  const isMatching = again.length > 0 && next === again;
  const canSave = isLongEnough && isMatching && (!currentLabel || current.length > 0) && !busy;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
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

  return (
    <form onSubmit={save} className="space-y-4">
      {currentLabel && <PasswordField label={currentLabel} value={current} onChange={setCurrent} autoComplete="current-password" />}

      <div>
        <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <StrengthMeter password={next} />
      </div>

      <div>
        <PasswordField label="Confirm new password" value={again} onChange={setAgain} autoComplete="new-password" />
        {again.length > 0 && (
          <p role="status" className={`mt-1.5 flex items-center gap-1.5 text-[12px] font-medium ${isMatching ? "text-loz-green-ink" : "text-loz-red-ink"}`}>
            {isMatching ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            {isMatching ? "Passwords match" : "Passwords do not match"}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-loz-red px-3 py-2 text-[12.5px] font-medium text-loz-red-ink">
          {error}
        </p>
      )}
      <button className="btn-primary w-full" disabled={!canSave}>
        {busy ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[12px] font-semibold text-ink-subtle">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={isVisible ? "text" : "password"}
          className="input w-full pr-11"
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-ink-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={isVisible}
        >
          {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

const STRENGTH = [
  { label: "Weak", bar: "bg-loz-red-ink", text: "text-loz-red-ink" },
  { label: "Fair", bar: "bg-loz-orange-ink", text: "text-loz-orange-ink" },
  { label: "Good", bar: "bg-loz-yellow-ink", text: "text-loz-yellow-ink" },
  { label: "Strong", bar: "bg-loz-green-ink", text: "text-loz-green-ink" },
];

// 0 Weak to 3 Strong. Length and a mix of letter cases, digits and symbols raise it;
// a short password or one made of a few repeated characters stays Weak.
export function passwordStrength(password: string) {
  if (password.length < MIN_PASSWORD || new Set(password).size < 5) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((kind) => kind.test(password)).length;
  const points = (password.length >= 14 ? 1 : 0) + (password.length >= 18 ? 1 : 0) + kinds - 1;
  return Math.min(3, Math.max(0, points));
}

function StrengthMeter({ password }: { password: string }) {
  const isLongEnough = password.length >= MIN_PASSWORD;
  const strength = passwordStrength(password);
  const level = STRENGTH[strength];
  return (
    <div className="mt-2 space-y-1.5">
      <div className="grid grid-cols-4 gap-1" role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={3} aria-valuenow={strength} aria-valuetext={password ? level.label : "Empty"}>
        {STRENGTH.map((step, i) => (
          <span key={step.label} className={`h-1.5 rounded-full transition-colors motion-reduce:transition-none ${password && i <= strength ? level.bar : "bg-surface-dim"}`} />
        ))}
      </div>
      <div className="flex items-center justify-between text-[12px]">
        <span className={`flex items-center gap-1.5 ${isLongEnough ? "font-medium text-loz-green-ink" : "text-ink-subtle"}`}>
          {isLongEnough ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}
          At least {MIN_PASSWORD} characters
        </span>
        {password && <span className={`font-semibold ${level.text}`}>{level.label}</span>}
      </div>
    </div>
  );
}
