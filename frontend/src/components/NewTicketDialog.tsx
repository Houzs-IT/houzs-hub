import { Paperclip } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Priority, type SystemRow, type TicketType } from "../api/client";
import { isFileDrag, mergePickedFiles, takePastedFiles } from "../lib/attachments";
import { PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL } from "../lib/labels";
import { Field, Select } from "./EditForm";
import PendingFile from "./PendingFile";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
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

  function addFiles(picked: File[]): void {
    if (!picked.length) return;
    const { files: merged, error: limitError } = mergePickedFiles(files, picked);
    setFiles(merged);
    setError(limitError);
  }

  function buildRequestBody(): FormData {
    const body = new FormData();
    body.set("system_code", form.systemCode);
    body.set("title", form.title);
    body.set("description", form.description);
    body.set("type", form.type);
    body.set("priority", form.priority);
    body.set("reporter_name", form.reporterName);
    files.forEach((file) => body.append("files", file));
    return body;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const { code } = await api<{ code: string }>("/tickets", { method: "POST", body: buildRequestBody() });
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
      <form
        onSubmit={submit}
        onPaste={(event) => addFiles(takePastedFiles(event))}
        onDragOver={(event) => {
          if (!isFileDrag(event)) return;
          // Without this the browser opens the dropped file in the tab and the typed form is lost.
          event.preventDefault();
          setIsDraggingFiles(true);
        }}
        onDragLeave={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          setIsDraggingFiles(false);
        }}
        onDrop={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          setIsDraggingFiles(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
        className="flex max-h-[90dvh] flex-col"
      >
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
          <div className="sm:col-span-2">
            <div className="text-[12px] font-semibold text-ink-subtle">Attachments</div>
            <div
              className={`mt-1 flex flex-wrap gap-2 rounded-md border-2 border-dashed p-2 transition-colors ${
                isDraggingFiles ? "border-primary bg-primary-soft" : "border-line"
              }`}
            >
              {files.map((file, index) => (
                <PendingFile key={`${file.name}-${index}`} file={file} onRemove={() => setFiles(files.filter((_, otherIndex) => otherIndex !== index))} />
              ))}
              <button type="button" className="btn-default h-auto min-h-[2.5rem]" onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="h-4 w-4" /> Attach files
              </button>
            </div>
            <span className="mt-1 block text-[11px] text-ink-subtlest">{isDraggingFiles ? "Drop to attach" : "Up to 5 files, 10 MB each. Drop files here or paste screenshots."}</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
          </div>
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
