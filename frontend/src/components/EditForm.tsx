import { Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { fmtAgo, fmtDateTime } from "../lib/format";

// Form pieces shared by pages that edit a list in a pop-up (System health).


export function Field(props: { label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string; area?: boolean; type?: string }) {
  return (
    <label className={`block text-[12px] font-semibold text-ink-subtle ${props.area ? "sm:col-span-2" : ""}`}>
      {props.label}
      {props.area ? (
        <textarea className="input mt-1 h-auto min-h-[64px] w-full py-2" rows={2} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input
          className="input mt-1 w-full"
          type={props.type ?? "text"}
          step={props.type === "number" ? "any" : undefined}
          required={props.required}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
      {props.hint && <span className="mt-1 block text-[11px] font-normal text-ink-subtlest">{props.hint}</span>}
    </label>
  );
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block text-[12px] font-semibold text-ink-subtle">
      {label}
      <select className="input mt-1 w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function EditDialog(props: {
  dialogRef: RefObject<HTMLDialogElement>;
  title: string;
  isNew: boolean;
  stamp: { updatedAt: string; updatedBy: string | null } | null;
  onSave: () => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
  saveLabel?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      props.dialogRef.current?.close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(props.onSave);
  };

  return (
    <dialog
      ref={props.dialogRef}
      onClose={() => {
        setErr(null);
        setConfirming(false);
        props.onClose();
      }}
      className="card w-[720px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40"
    >
      <form onSubmit={submit}>
        <div className="border-b border-line px-5 py-3 text-[15px] font-bold">{props.title}</div>
        <div className="grid max-h-[65vh] gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">{props.children}</div>
        {err && (
          <div role="alert" className="mx-5 mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
            {err}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {!props.isNew &&
            (confirming ? (
              <>
                <span className="text-sm text-loz-red-ink">Remove for good?</span>
                <button type="button" className="btn border border-loz-red-ink bg-loz-red-ink text-surface hover:opacity-90" disabled={busy} onClick={() => run(props.onRemove)}>
                  Remove
                </button>
                <button type="button" className="btn-subtle" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="btn-subtle text-loz-red-ink" onClick={() => setConfirming(true)}>
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            ))}
          {props.stamp && (
            <span className="text-[11px] text-ink-subtlest" title={fmtDateTime(props.stamp.updatedAt)}>
              Updated {fmtAgo(props.stamp.updatedAt)}
              {props.stamp.updatedBy ? ` by ${props.stamp.updatedBy}` : ""}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-default" onClick={() => props.dialogRef.current?.close()}>
              Cancel
            </button>
            <button className="btn-primary" disabled={busy}>
              {props.saveLabel ?? (props.isNew ? "Add" : "Save")}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
