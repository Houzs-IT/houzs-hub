import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, json, type Priority, type SystemRow, type TicketType } from "../api/client";
import { PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL } from "../lib/labels";
import { Field, Select } from "./EditForm";

export interface NewTicketDialogProps {
  systems: SystemRow[];
  defaultSystemCode: string;
  onCreated: (code: string) => void;
  onClose: () => void;
}

interface NewTicketForm {
  systemCode: string;
  title: string;
  description: string;
  type: TicketType;
  priority: Priority;
  reporterName: string;
}

export default function NewTicketDialog({ systems, defaultSystemCode, onCreated, onClose }: NewTicketDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<NewTicketForm>({
    systemCode: defaultSystemCode,
    title: "",
    description: "",
    type: "bug",
    priority: "medium",
    reporterName: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => dialogRef.current?.showModal(), []);

  function update(changes: Partial<NewTicketForm>): void {
    setForm((current) => ({ ...current, ...changes }));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const { code } = await api<{ code: string }>(
        "/tickets",
        json("POST", {
          system_code: form.systemCode,
          title: form.title,
          description: form.description,
          type: form.type,
          priority: form.priority,
          reporter_name: form.reporterName,
        }),
      );
      onCreated(code);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setIsSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="new-ticket-title"
      className="card w-[640px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40 max-sm:mb-0 max-sm:mt-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none"
    >
      <form onSubmit={submit} className="flex max-h-[90dvh] flex-col">
        <div className="border-b border-line px-5 py-3">
          <h2 id="new-ticket-title" className="text-[15px] font-bold">
            New ticket
          </h2>
        </div>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          <Select
            label="System"
            value={form.systemCode}
            onChange={(systemCode) => update({ systemCode })}
            options={systems.map((system) => [system.code, system.name])}
          />
          <Field label="Reporter" value={form.reporterName} onChange={(reporterName) => update({ reporterName })} required />
          <div className="sm:col-span-2">
            <Field label="Title" value={form.title} onChange={(title) => update({ title })} required />
          </div>
          <Field label="Description" value={form.description} onChange={(description) => update({ description })} area />
          <Select
            label="Type"
            value={form.type}
            onChange={(type) => update({ type: TYPES.find((option) => option === type) ?? "bug" })}
            options={TYPES.map((option) => [option, TYPE_LABEL[option]])}
          />
          <Select
            label="Priority"
            value={form.priority}
            onChange={(priority) => update({ priority: PRIORITIES.find((option) => option === priority) ?? "medium" })}
            options={PRIORITIES.map((option) => [option, PRIORITY_LABEL[option]])}
          />
        </div>
        {error && (
          <div role="alert" className="mx-5 mb-3 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" className="btn-default" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button className="btn-primary" disabled={isSaving}>
            {isSaving ? "Creating…" : "Create ticket"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
