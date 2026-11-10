import { ArrowRight, CalendarClock, ChevronLeft, Check, ChevronDown, ExternalLink, FileText, Lock, Mail, Maximize2, MessageSquare, Paperclip, Phone, Play, Tag, Trash2, UserPlus, Users, X, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, attachmentUrl, json, type Attachment, type Status, type TicketEvent, type TicketFull, type User } from "../api/client";
import { fmtAgo, fmtDateTime, fmtSize } from "../lib/format";
import { ACTIVE, PRIORITIES, PRIORITY_DOT_STYLE, PRIORITY_LABEL, STATUSES, STATUS_DOT_STYLE, STATUS_LABEL, STATUS_STYLE, TYPES, TYPE_LABEL, systemTagStyle } from "../lib/labels";
import { usePoll } from "../lib/usePoll";
import { Avatar, Lozenge, TypeIcon } from "./Bits";
import { useOutside } from "./FilterButton";
import ImageLightbox from "./ImageLightbox";
import { useHub } from "./Layout";
import VideoLightbox, { isVideoFile } from "./VideoLightbox";

type Detail = { ticket: TicketFull; events: TicketEvent[]; modules?: string[] };

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function Attachments({ items }: { items: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (!items.length) return null;

  function openInPage(event: MouseEvent<HTMLAnchorElement>, attachment: Attachment): void {
    // Ctrl/Cmd/Shift-click (and middle-click, which never fires onClick) still open the file in a new tab.
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    setViewing(attachment);
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {viewing &&
        (isVideoFile(viewing.mime, viewing.filename) ? (
          <VideoLightbox src={attachmentUrl(viewing.id)} title={viewing.filename} onClose={() => setViewing(null)} />
        ) : (
          <ImageLightbox src={attachmentUrl(viewing.id)} alt={viewing.filename} onClose={() => setViewing(null)} />
        ))}
      {items.map((a) =>
        a.mime.startsWith("image/") ? (
          <a
            key={a.id}
            href={attachmentUrl(a.id)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => openInPage(e, a)}
            className="group block w-40 overflow-hidden rounded border border-line"
          >
            <img src={attachmentUrl(a.id)} alt={a.filename} className="h-24 w-full object-cover group-hover:opacity-90" />
            <div className="truncate border-t border-line px-2 py-1 text-xs text-ink-subtle">{a.filename}</div>
          </a>
        ) : isVideoFile(a.mime, a.filename) ? (
          <a
            key={a.id}
            href={attachmentUrl(a.id)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => openInPage(e, a)}
            aria-label={`Play ${a.filename}`}
            className="group flex w-40 flex-col justify-between rounded border border-line p-2 text-xs hover:bg-hover"
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-ink/80 text-surface group-hover:bg-ink">
              <Play className="h-3 w-3 translate-x-px fill-current" />
            </span>
            <span className="mt-2 truncate text-ink">{a.filename}</span>
            <span className="text-ink-subtlest">{fmtSize(a.size)}</span>
          </a>
        ) : (
          <a
            key={a.id}
            href={attachmentUrl(a.id)}
            target="_blank"
            rel="noreferrer"
            className="flex w-40 flex-col justify-between rounded border border-line p-2 text-xs hover:bg-hover"
          >
            <FileText className="h-6 w-6 text-ink-subtle" />
            <span className="mt-2 truncate text-ink">{a.filename}</span>
            <span className="text-ink-subtlest">{fmtSize(a.size)}</span>
          </a>
        ),
      )}
    </div>
  );
}

function PendingFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isViewing, setIsViewing] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!previewUrl) return null;
  const isVideo = isVideoFile(file.type, file.name);
  return (
    <div className="relative w-28 overflow-hidden rounded border border-line bg-surface">
      {isViewing &&
        (isVideo ? (
          <VideoLightbox src={previewUrl} title={file.name} onClose={() => setIsViewing(false)} />
        ) : (
          <ImageLightbox src={previewUrl} alt={file.name} onClose={() => setIsViewing(false)} />
        ))}
      {file.type.startsWith("image/") ? (
        <button type="button" className="block w-full" aria-label={`Preview ${file.name}`} onClick={() => setIsViewing(true)}>
          <img src={previewUrl} alt="" className="h-20 w-full object-cover hover:opacity-90" />
        </button>
      ) : isVideo ? (
        <button type="button" className="grid h-20 w-full place-items-center hover:bg-hover" aria-label={`Play ${file.name}`} onClick={() => setIsViewing(true)}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink/80 text-surface">
            <Play className="h-4 w-4 translate-x-px fill-current" />
          </span>
        </button>
      ) : (
        <a href={previewUrl} target="_blank" rel="noreferrer" aria-label={`Open ${file.name}`} className="grid h-20 place-items-center hover:bg-hover">
          <FileText className="h-6 w-6 text-ink-subtle" />
        </a>
      )}
      <div className="truncate border-t border-line px-2 py-1 text-xs text-ink-subtle" title={file.name}>
        {file.name}
      </div>
      <button
        type="button"
        className="tap absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function StatusButton({ status, disabled, onChange }: { status: Status; disabled: boolean; onChange: (s: Status) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${STATUS_LABEL[status]}. Change status`}
        className={`btn h-9 px-3.5 ${STATUS_STYLE[status]} hover:brightness-95`}
      >
        <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_DOT_STYLE[status]}`} />
        {STATUS_LABEL[status]}
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && <div className="fixed inset-0 z-20 bg-black/30 sm:hidden" onClick={() => setOpen(false)} />}
      {open && (
        <div role="menu" className="absolute left-0 top-10 z-30 max-h-[60vh] min-w-[220px] overflow-y-auto overscroll-contain rounded-[10px] border border-transparent bg-overlay py-1.5 shadow-overlay max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 max-sm:top-auto">
          {STATUSES.map((s) => {
            const isCurrent = s === status;
            return (
              <button
                key={s}
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => {
                  setOpen(false);
                  if (!isCurrent) onChange(s);
                }}
                className={`tap flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm hover:bg-hover ${isCurrent ? "font-semibold text-ink" : "text-ink-subtle hover:text-ink"}`}
              >
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_STYLE[s]}`} />
                <span className="flex-1">{STATUS_LABEL[s]}</span>
                {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function historyText(e: TicketEvent): ReactNode {
  if (e.kind === "created") return <>created the ticket</>;
  if (e.kind === "assign") return e.toValue ? <>assigned the ticket to <b className="font-semibold">{e.toValue}</b></> : <>unassigned {e.fromValue}</>;
  if (e.kind === "status")
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        changed the Status
        {e.fromValue && <Lozenge status={e.fromValue as Status} />}
        <ArrowRight className="h-3.5 w-3.5 text-ink-subtlest" />
        {e.toValue && <Lozenge status={e.toValue as Status} />}
      </span>
    );
  if (e.kind === "module")
    return e.toValue ? (
      <>
        set the Module to <b className="font-semibold">{e.toValue}</b>
        {e.fromValue && <> (was {e.fromValue})</>}
      </>
    ) : (
      <>cleared the Module {e.fromValue}</>
    );
  const label = (v: string | null) =>
    e.kind === "priority" ? PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? v : TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? v;
  return (
    <>
      changed the {e.kind === "priority" ? "Priority" : "Type"} from <b className="font-semibold">{label(e.fromValue)}</b> to{" "}
      <b className="font-semibold">{label(e.toValue)}</b>
    </>
  );
}

function CommentActions({ code, e, onEdit, onDone }: { code: string; e: TicketEvent; onEdit: () => void; onDone: () => void }) {
  const { me } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmDelete = useRef<HTMLDialogElement>(null);
  const isMine = e.userId === me.id;
  if (!isMine && !me.perms?.includes("delete_tickets")) return null;
  const what = e.visibility === "internal" ? "internal note" : "reply";

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api(`/tickets/${code}/comments/${e.id}`, { method: "DELETE" });
      confirmDelete.current?.close();
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <span className="ml-auto flex items-center text-xs">
      {isMine && (
        <button className="tap px-2 font-medium text-ink-subtle hover:text-ink hover:underline" onClick={onEdit}>
          Edit
        </button>
      )}
      <button
        className="tap px-2 font-medium text-ink-subtle hover:text-loz-red-ink hover:underline"
        onClick={() => {
          setError(null);
          confirmDelete.current?.showModal();
        }}
      >
        Delete
      </button>
      <dialog ref={confirmDelete} className="card w-[400px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40">
        <div className="border-b border-line px-5 py-3 text-[15px] font-bold">Delete {what}</div>
        <p className="px-5 py-4 text-sm leading-6 text-ink-subtle">
          Delete this {what} by <span className="font-semibold text-ink">{e.authorName}</span>
          {e.attachments.length ? " and its files" : ""}? This action cannot be undone.
        </p>
        {error && (
          <p className="px-5 pb-3 text-sm text-loz-red-ink" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button className="btn-default" autoFocus onClick={() => confirmDelete.current?.close()}>
            Cancel
          </button>
          <button className="btn border border-loz-red-ink bg-loz-red-ink text-surface hover:opacity-90" disabled={busy} onClick={remove}>
            {busy ? "Deleting..." : "Delete"}
          </button>
        </div>
      </dialog>
    </span>
  );
}

function CommentEditor({ code, e, onClose, onDone }: { code: string; e: TicketEvent; onClose: () => void; onDone: () => void }) {
  const [body, setBody] = useState(e.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    try {
      await api(`/tickets/${code}/comments/${e.id}`, json("PATCH", { body }));
      onClose();
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mt-1">
      <textarea
        autoFocus
        value={body}
        onChange={(ev) => setBody(ev.target.value)}
        aria-label="Edit comment"
        className="block h-28 w-full resize-y rounded border-2 border-primary bg-surface px-3 py-2 text-sm outline-none"
      />
      {error && <div className="mt-1 text-xs text-loz-red-ink">{error}</div>}
      <div className="mt-2 flex gap-2">
        <button className="btn-primary" disabled={busy || body.trim() === (e.body ?? "")} onClick={save}>
          Save
        </button>
        <button className="btn-subtle" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ActivityItem({ code, e, onChanged }: { code: string; e: TicketEvent; onChanged: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const name = e.authorKind === "system" ? "System" : e.authorName;
  const when = (
    <span className="text-xs text-ink-subtlest" title={fmtDateTime(e.createdAt)}>
      {fmtAgo(e.createdAt)}
    </span>
  );
  if (e.kind === "comment") {
    const internal = e.visibility === "internal";
    return (
      <div className="flex gap-3">
        <Avatar name={name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{name}</span>
            {e.authorKind === "reporter" && <span className="text-xs text-ink-subtlest">Reporter</span>}
            {internal ? (
              <span className="pill bg-loz-yellow text-loz-yellow-ink">
                <Lock className="h-3 w-3" /> Internal note
              </span>
            ) : (
              e.authorKind === "developer" && (
                <span className="pill bg-primary-soft text-primary-ink">
                  Reply to reporter
                </span>
              )
            )}
            {when}
            {e.editedAt && (
              <span className="text-xs text-ink-subtlest" title={`Edited ${fmtDateTime(e.editedAt)}`}>
                (edited)
              </span>
            )}
            {!isEditing && <CommentActions code={code} e={e} onEdit={() => setIsEditing(true)} onDone={onChanged} />}
          </div>
          {isEditing ? (
            <CommentEditor code={code} e={e} onClose={() => setIsEditing(false)} onDone={onChanged} />
          ) : (
            <div className={`mt-1 rounded ${internal ? "border-l-4 border-note-line bg-note px-3 py-2" : ""}`}>
              {e.body && <div className="whitespace-pre-wrap break-words text-sm leading-6">{e.body}</div>}
              <Attachments items={e.attachments} />
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <Avatar name={name} size={32} />
      <div className="min-w-0 flex-1 pt-1 text-sm text-ink">
        <span className="font-semibold">{name}</span> <span className="text-ink-subtle">{historyText(e)}</span>
        <div>{when}</div>
        {e.body && <div className="mt-0.5 break-words text-xs text-ink-subtle">{e.body}</div>}
      </div>
    </div>
  );
}

function Composer({ code, status, onDone }: { code: string; status: Status; onDone: () => void }) {
  const { me } = useHub();
  const [mode, setMode] = useState<"public" | "internal" | null>(null);
  const [body, setBody] = useState("");
  const [thenStatus, setThenStatus] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function cancel() {
    if ((body.trim() || files.length) && !confirm("Discard what you wrote?")) return;
    reset();
  }

  function addFiles(picked: File[]) {
    // Same limits as the server, told up front instead of after a long upload.
    const tooBig = picked.filter((f) => f.size > MAX_FILE_BYTES);
    const next = [...files, ...picked.filter((f) => f.size <= MAX_FILE_BYTES)];
    if (tooBig.length) setError(`${tooBig.map((f) => f.name).join(", ")}: over 10 MB, not attached`);
    else if (next.length > MAX_FILES) setError(`Up to ${MAX_FILES} files per message; the rest were not attached`);
    else setError(null);
    setFiles(next.slice(0, MAX_FILES));
  }

  function pasteFiles(e: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(e.clipboardData.files);
    // Excel and Word also put a picture of copied text on the clipboard; paste that as text.
    if (!pasted.length || e.clipboardData.types.includes("text/plain")) return;
    e.preventDefault();
    addFiles(pasted);
  }

  function reset() {
    setMode(null);
    setBody("");
    setFiles([]);
    setThenStatus("");
    setError(null);
  }

  async function save() {
    const fd = new FormData();
    fd.set("body", body);
    fd.set("visibility", mode!);
    if (thenStatus) fd.set("status", thenStatus);
    files.forEach((f) => fd.append("files", f));
    setBusy(true);
    try {
      await api(`/tickets/${code}/comments`, { method: "POST", body: fd });
      reset();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!mode) {
    return (
      <div className="flex gap-3">
        <Avatar name={me.name} size={32} />
        <div className="flex-1 rounded border border-line px-3 py-2 text-sm text-ink-subtlest">
          <button className="tap font-medium text-primary hover:underline" onClick={() => setMode("public")}>
            Reply to reporter
          </button>
          <span className="mx-2">or</span>
          <button className="tap font-medium text-primary hover:underline" onClick={() => setMode("internal")}>
            Add internal note
          </button>
        </div>
      </div>
    );
  }

  const internal = mode === "internal";
  return (
    <div className="flex gap-3">
      <Avatar name={me.name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex gap-1">
          {(["public", "internal"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`tap rounded px-2 py-1 text-xs font-semibold ${mode === m ? "bg-primary-soft text-primary" : "text-ink-subtle hover:bg-hover"}`}
            >
              {m === "public" ? "Reply to reporter" : "Add internal note"}
            </button>
          ))}
        </div>
        <div className={`rounded border-2 ${internal ? "border-note-line bg-note" : "border-primary bg-surface"}`}>
          <textarea
            autoFocus
            aria-label={internal ? "Internal note" : "Reply to reporter"}
            className="block h-28 w-full resize-y bg-transparent px-3 py-2 text-sm outline-none"
            placeholder={internal ? "Only developers can see internal notes" : "The reporter will see this in their system"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={pasteFiles}
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {files.map((file, i) => (
                <PendingFile key={i} file={file} onRemove={() => setFiles(files.filter((_, j) => j !== i))} />
              ))}
            </div>
          )}
        </div>
        {error && <div className="mt-1 text-xs text-loz-red-ink">{error}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={busy || (!body.trim() && !files.length)} onClick={save}>
            {internal ? "Add note" : "Send to reporter"}
          </button>
          <button className="btn-subtle" onClick={cancel}>
            Cancel
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button className="btn-subtle px-2" title="Attach files" aria-label="Attach files" onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-subtle">
            Then move to
            <select className="input h-8 py-0" value={thenStatus} onChange={(e) => setThenStatus(e.target.value)}>
              <option value="">(keep {STATUS_LABEL[status]})</option>
              {STATUSES.filter((s) => s !== status).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

// Free text so each system can name its own modules; the ones already used are suggested.
// A styled menu instead of <select>, whose drop-down the browser draws unstyled and at its own width.
function AssigneeField({ value, people, disabled, onPick }: { value: number | null; people: User[]; disabled: boolean; onPick: (id: number | null) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(isOpen, () => setIsOpen(false));
  const picked = people.find((person) => person.id === value);
  const choices: { id: number | null; name: string }[] = [{ id: null, name: "Unassigned" }, ...people];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Assignee"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-select -my-1.5 flex items-center gap-1 ${picked ? "font-semibold" : "text-ink-subtlest"}`}
      >
        <span className="truncate">{picked?.name ?? "Unassigned"}</span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ink-subtle" />
      </button>
      {isOpen && (
        <div
          role="listbox"
          aria-label="Assignee"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-60 overflow-y-auto overscroll-contain rounded-[10px] border border-line bg-overlay py-1.5 shadow-overlay"
        >
          {choices.map((choice) => {
            const isPicked = choice.id === value;
            return (
              <button
                key={choice.id ?? "none"}
                type="button"
                role="option"
                aria-selected={isPicked}
                onClick={() => {
                  setIsOpen(false);
                  if (!isPicked) onPick(choice.id);
                }}
                className={`tap flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover ${
                  isPicked ? "font-semibold text-primary" : choice.id ? "text-ink" : "text-ink-subtle"
                }`}
              >
                <span className="truncate">{choice.name}</span>
                {isPicked && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A styled suggestion menu instead of <datalist>, whose popup the browser draws unstyled and at its own width.
function ModuleField({ value, options, disabled, onSave }: { value: string | null; options: string[]; disabled: boolean; onSave: (v: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const lastSaved = useRef(value);
  const menuId = useId();
  const isTyping = draft !== (value ?? "");
  const query = draft.trim().toLowerCase();
  const suggestions = isTyping ? options.filter((option) => option.toLowerCase().includes(query)) : options;

  function save(text: string) {
    const next = text.trim() || null;
    if (next === lastSaved.current) return;
    lastSaved.current = next;
    onSave(next);
  }

  function pick(option: string) {
    setDraft(option);
    setIsOpen(false);
    save(option);
  }

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setIsOpen(false);
        save(draft);
      }}
    >
      <input
        className="inline-select -my-1.5 cursor-text"
        role="combobox"
        aria-label="Module"
        aria-expanded={isOpen && suggestions.length > 0}
        aria-controls={menuId}
        aria-autocomplete="list"
        placeholder="Not set"
        maxLength={60}
        value={draft}
        disabled={disabled}
        onFocus={() => setIsOpen(true)}
        onChange={(e) => {
          setDraft(e.target.value);
          setIsOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setIsOpen(false);
            save(draft);
          }
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setIsOpen(false);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.currentTarget.parentElement?.querySelector<HTMLElement>("[role=option]")?.focus();
          }
        }}
      />
      {isOpen && suggestions.length > 0 && (
        <div
          id={menuId}
          role="listbox"
          aria-label="Modules"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-60 overflow-y-auto overscroll-contain rounded-[10px] border border-line bg-overlay py-1.5 shadow-overlay"
        >
          {suggestions.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(option)}
              onKeyDown={(e) => {
                const sibling = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.key === "ArrowUp" ? e.currentTarget.previousElementSibling : null;
                if (sibling instanceof HTMLElement) {
                  e.preventDefault();
                  sibling.focus();
                }
              }}
              className={`tap flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover focus-visible:bg-hover focus-visible:outline-none ${
                option === value ? "font-semibold text-primary" : "text-ink"
              }`}
            >
              <span className="truncate">{option}</span>
              {option === value && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SECTION_TONES = {
  blue: { card: "border-loz-blue-ink/25 bg-loz-blue/40", header: "border-loz-blue-ink/20 bg-loz-blue", ink: "text-loz-blue-ink" },
  purple: { card: "border-loz-purple-ink/25 bg-loz-purple/40", header: "border-loz-purple-ink/20 bg-loz-purple", ink: "text-loz-purple-ink" },
  green: { card: "border-loz-green-ink/25 bg-loz-green/40", header: "border-loz-green-ink/20 bg-loz-green", ink: "text-loz-green-ink" },
  yellow: { card: "border-loz-yellow-ink/25 bg-loz-yellow/40", header: "border-loz-yellow-ink/20 bg-loz-yellow", ink: "text-loz-yellow-ink" },
} as const;

type SectionTone = keyof typeof SECTION_TONES;

interface SectionProps {
  title: string;
  icon: LucideIcon;
  tone: SectionTone;
  children: ReactNode;
}

function Section({ title, icon: Icon, tone, children }: SectionProps): JSX.Element {
  const { card, header, ink } = SECTION_TONES[tone];
  return (
    <section className={`card ${card}`}>
      <div className={`flex items-center gap-2.5 rounded-t-[9px] border-b px-4 py-2.5 ${header}`}>
        <span aria-hidden className={`grid h-6 w-6 place-items-center rounded-md bg-surface/70 ${ink}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
        <h2 className={`text-[10px] font-bold uppercase tracking-brand ${ink}`}>{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

interface Choice<Value extends string> {
  value: Value;
  label: string;
  mark: ReactNode;
}

interface ChoiceGroupProps<Value extends string> {
  label: string;
  choices: Choice<Value>[];
  value: Value;
  disabled: boolean;
  onPick: (value: Value) => void;
}

function ChoiceGroup<Value extends string>({ label, choices, value, disabled, onPick }: ChoiceGroupProps<Value>): JSX.Element {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full gap-1 rounded-lg border border-line bg-surface/80 p-1">
      {choices.map((choice) => {
        const isPicked = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={isPicked}
            disabled={disabled}
            onClick={() => !isPicked && onPick(choice.value)}
            className={`tap flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors motion-reduce:transition-none disabled:opacity-60 ${
              isPicked ? "bg-surface text-ink shadow-stone ring-1 ring-line-strong" : "text-ink-subtle hover:bg-hover"
            }`}
          >
            {choice.mark}
            <span className="truncate">{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-subtlest">{children}</div>;
}

interface TimelineEntry {
  label: string;
  at: string | null;
  dot: string;
}

function Timeline({ entries }: { entries: TimelineEntry[] }): JSX.Element {
  const shownEntries = entries.filter((entry) => entry.at);
  return (
    <ol className="relative space-y-3 before:absolute before:bottom-1.5 before:left-[4px] before:top-1.5 before:w-px before:bg-line">
      {shownEntries.map((entry) => (
        <li key={entry.label} className="relative flex items-baseline gap-3 pl-5">
          <span aria-hidden className={`absolute left-0 top-[5px] h-[9px] w-[9px] rounded-full ring-2 ring-surface ${entry.dot}`} />
          <span className="w-24 shrink-0 text-xs font-semibold text-ink-subtle">{entry.label}</span>
          <span className="text-sm tabular-nums text-ink">{entry.at && fmtDateTime(entry.at)}</span>
        </li>
      ))}
    </ol>
  );
}

export default function IssueView({ code, variant, onClose }: { code: string; variant: "panel" | "page"; onClose?: () => void }) {
  const { me, users, refresh, version, changedCode } = useHub();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"all" | "comments" | "history">("all");
  const navigate = useNavigate();
  const confirmDelete = useRef<HTMLDialogElement>(null);
  const confirmAssign = useRef<HTMLDialogElement>(null);
  const [pendingAssigneeId, setPendingAssigneeId] = useState<{ value: number | null } | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  function jumpToReply() {
    composerRef.current?.scrollIntoView({ block: "start" });
    composerRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }

  const load = useCallback(() => {
    api<Detail>(`/tickets/${code}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [code]);

  useEffect(load, [load]);
  // Live updates about other tickets do not reload this one.
  const seenVersion = useRef(version);
  useEffect(() => {
    if (version === seenVersion.current) return;
    seenVersion.current = version;
    if (!changedCode || changedCode === code) load();
  }, [version, changedCode, code, load]);
  usePoll(load, 60_000);

  async function patch(body: Record<string, unknown>, path = "") {
    setSaving(true);
    try {
      await api(`/tickets/${code}${path}`, path ? { method: "POST" } : json("PATCH", body));
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    confirmDelete.current?.close();
    setSaving(true);
    try {
      await api(`/tickets/${code}`, { method: "DELETE" });
      if (onClose) onClose();
      else navigate("/tickets");
      refresh();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className={variant === "panel" ? "flex h-full flex-col" : ""}>
        {variant === "panel" && (
          <div className="flex justify-end border-b border-line px-4 py-3 md:px-6">
            <button className="btn-subtle px-2" title="Close" aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 p-8 text-sm text-ink-subtle" role={error ? "alert" : undefined}>
          {error ?? "Loading..."}
          {error && (
            <button className="btn-default" onClick={load}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const { ticket: t, events } = data;
  const created = events.find((e) => e.kind === "created");
  const shown = events
    .filter((e) => e.kind !== "created" || tab !== "comments")
    .filter((e) => (tab === "comments" ? e.kind === "comment" : tab === "history" ? e.kind !== "comment" : true))
    .slice()
    .reverse();
  const assignee = users.find((d) => d.id === t.assigneeId);
  const canPickUp = ACTIVE.includes(t.status) && !t.assigneeId;

  // Taking a ticket off a colleague is confirmed first; handing over your own or an unassigned one is not.
  function requestAssign(nextAssigneeId: number | null): void {
    if (nextAssigneeId === t.assigneeId) return;
    const isSomeoneElses = t.assigneeId !== null && t.assigneeId !== me.id;
    if (!isSomeoneElses) {
      patch({ assignee_id: nextAssigneeId });
      return;
    }
    setPendingAssigneeId({ value: nextAssigneeId });
    confirmAssign.current?.showModal();
  }

  function closeAssignConfirm(): void {
    confirmAssign.current?.close();
    setPendingAssigneeId(null);
  }

  const nextAssignee = pendingAssigneeId && users.find((d) => d.id === pendingAssigneeId.value);
  const assignAction = !pendingAssigneeId ? "" : pendingAssigneeId.value === null ? "Unassign" : pendingAssigneeId.value === me.id ? "Take ticket" : "Reassign";

  const statusControls = (
    <div className="flex flex-wrap items-center gap-2">
      <StatusButton status={t.status} disabled={saving} onChange={(st) => patch({ status: st })} />
      {canPickUp && (
        <button className="btn-primary px-3.5" disabled={saving} onClick={() => patch({}, "/pickup")}>
          <UserPlus className="h-4 w-4" /> Pick up
        </button>
      )}
    </div>
  );

  const deleteButton = me.perms?.includes("delete_tickets") && (
    <button
      className="btn bg-loz-red px-3 text-loz-red-ink transition-colors duration-150 hover:brightness-95"
      disabled={saving}
      onClick={() => confirmDelete.current?.showModal()}
    >
      <Trash2 className="h-4 w-4" /> Delete
    </button>
  );

  const deleteDialog = (
      <dialog
        ref={confirmDelete}
        className="card w-[400px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40"
      >
        <div className="border-b border-line px-5 py-3 text-[15px] font-bold">Delete ticket</div>
        <p className="px-5 py-4 text-sm leading-6 text-ink-subtle">
          Delete <span className="font-semibold text-ink">{t.code}</span> with all its comments and files? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button className="btn-default" autoFocus onClick={() => confirmDelete.current?.close()}>
            Cancel
          </button>
          <button className="btn border border-loz-red-ink bg-loz-red-ink text-surface hover:opacity-90" onClick={remove}>
            Delete
          </button>
        </div>
      </dialog>
  );

  const assignDialog = (
    <dialog ref={confirmAssign} onClose={() => setPendingAssigneeId(null)} className="card w-[400px] max-w-[calc(100vw-32px)] p-0 text-ink backdrop:bg-black/40">
      <div className="border-b border-line px-5 py-3 text-[15px] font-bold">{assignAction}</div>
      <div className="px-5 py-4 text-sm leading-6 text-ink-subtle">
        <p>
          <span className="font-semibold text-ink">{t.code}</span> is assigned to <span className="font-semibold text-ink">{assignee?.name ?? "someone else"}</span>.
        </p>
        <p className="mt-1">
          {pendingAssigneeId?.value === null
            ? "Leave it unassigned?"
            : pendingAssigneeId?.value === me.id
              ? "Take it over?"
              : `Hand it to ${nextAssignee?.name ?? "this person"}?`}{" "}
          They will see the change in the ticket history.
        </p>
      </div>
      <div className="flex justify-end gap-2 px-5 pb-4">
        <button className="btn-default" autoFocus onClick={closeAssignConfirm}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            const next = pendingAssigneeId;
            closeAssignConfirm();
            if (next) patch({ assignee_id: next.value });
          }}
        >
          {assignAction}
        </button>
      </div>
    </dialog>
  );

  const overview = (
      <Section title="Overview" icon={Users} tone="blue">
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg bg-surface/80 p-3">
            <Avatar name={assignee?.name} size={32} />
            <div className="min-w-0 flex-1">
              <FieldLabel>Assignee</FieldLabel>
              <AssigneeField value={t.assigneeId} people={users} disabled={saving} onPick={requestAssign} />
              {/* Pick up already assigns you (and moves Open to On Going), so only one of them shows. */}
              {t.assigneeId !== me.id && !canPickUp && (
                <button
                  className="tap inline-flex items-center text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  disabled={saving}
                  onClick={() => requestAssign(me.id)}
                >
                  Assign to me
                </button>
              )}
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-surface/80 p-3">
            <Avatar name={t.reporterName} size={32} />
            <div className="min-w-0 flex-1">
              <FieldLabel>Reporter</FieldLabel>
              <div className="truncate text-sm font-semibold text-ink">{t.reporterName}</div>
              {t.reporterDepartment && <div className="text-xs text-ink-subtle">{t.reporterDepartment}</div>}
              {(t.reporterPhone || t.reporterEmail) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.reporterPhone && (
                    <a
                      className="tap inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50"
                      href={`https://wa.me/${t.reporterPhone.replace(/\D/g, "").replace(/^0/, "60")}`}
                      title="Open in WhatsApp"
                      aria-label={`WhatsApp ${t.reporterPhone}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Phone className="h-3 w-3" /> {t.reporterPhone}
                    </a>
                  )}
                  {t.reporterEmail && (
                    <a
                      className="tap inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-medium text-primary hover:border-primary/50"
                      href={`mailto:${t.reporterEmail}`}
                    >
                      <Mail className="h-3 w-3 shrink-0" /> <span className="break-all">{t.reporterEmail}</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 pt-1">
          <div>
            <FieldLabel>Priority</FieldLabel>
            <ChoiceGroup
              label="Priority"
              value={t.priority}
              disabled={saving}
              onPick={(priority) => patch({ priority })}
              choices={PRIORITIES.map((priority) => ({
                value: priority,
                label: PRIORITY_LABEL[priority],
                mark: <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT_STYLE[priority]}`} />,
              }))}
            />
          </div>
          <div>
            <FieldLabel>Type</FieldLabel>
            <ChoiceGroup
              label="Type"
              value={t.type}
              disabled={saving}
              onPick={(type) => patch({ type })}
              choices={TYPES.map((type) => ({ value: type, label: TYPE_LABEL[type], mark: <TypeIcon type={type} /> }))}
            />
          </div>
          </div>
        </div>
      </Section>
  );

  const properties = (
      <Section title="Properties" icon={Tag} tone="purple">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <FieldLabel>System</FieldLabel>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className={`inline-flex h-5 items-center rounded border px-1.5 font-docno text-[10.5px] ${systemTagStyle(t.systemCode)}`}>{t.systemCode}</span>
              <span className="truncate">{t.system_name}</span>
            </div>
          </div>
          <div className="min-w-0">
            <FieldLabel>Module</FieldLabel>
            <ModuleField key={t.module ?? ""} value={t.module} options={data.modules ?? []} disabled={saving} onSave={(module) => patch({ module })} />
          </div>
          {t.pageUrl && (
            <div className="min-w-0 sm:col-span-2">
              <FieldLabel>Page</FieldLabel>
              <a className="break-all text-sm text-primary hover:underline" href={t.pageUrl} target="_blank" rel="noreferrer">
                {t.pageUrl}
                <ExternalLink className="ml-1 inline h-3 w-3 align-[-1px]" />
              </a>
            </div>
          )}
          {t.legacyCode && (
            <div className="min-w-0">
              <FieldLabel>Sheet ID</FieldLabel>
              <div className="font-docno text-sm text-ink">{t.legacyCode}</div>
            </div>
          )}
        </div>
      </Section>
  );

  const timeline = (
      <Section title="Timeline" icon={CalendarClock} tone="green">
        <Timeline
          entries={[
            // Tickets from before occurred_at defaulted to submission time fall back to it here too.
            { label: "Occurred", at: t.occurredAt ?? t.createdAt, dot: STATUS_DOT_STYLE.open },
            { label: "Picked up", at: t.pickedUpAt, dot: STATUS_DOT_STYLE.in_progress },
            { label: "Done", at: t.resolvedAt, dot: STATUS_DOT_STYLE.resolved },
            { label: "Closed", at: t.closedAt, dot: STATUS_DOT_STYLE.closed },
            { label: "Last updated", at: t.updatedAt, dot: "bg-primary" },
          ]}
        />
      </Section>
  );

  const description = (
      <Section title="Description" icon={FileText} tone="yellow">
        <div className="whitespace-pre-wrap break-words text-sm leading-6">{t.description || <span className="text-ink-subtlest">No description</span>}</div>
        {created && created.attachments.length > 0 && (
          <div className="mt-4 border-t border-loz-yellow-ink/20 pt-3">
            <FieldLabel>Attachments ({created.attachments.length})</FieldLabel>
            <Attachments items={created.attachments} />
          </div>
        )}
      </Section>
  );

  const composer = <Composer code={code} status={t.status} onDone={refresh} />;

  const activity = (composerSlot: ReactNode): JSX.Element => (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="section-title">Activity</div>
        <div role="group" aria-label="Show activity" className="inline-flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5 text-[12.5px]">
          {(["all", "comments", "history"] as const).map((k) => (
            <button
              key={k}
              aria-pressed={tab === k}
              onClick={() => setTab(k)}
              className={`tap rounded-md px-2.5 py-1 font-semibold ${tab === k ? "bg-surface text-ink shadow-stone" : "text-ink-subtle hover:text-ink"}`}
            >
              {k === "all" ? "All" : k === "comments" ? "Comments" : "History"}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-5">
        {composerSlot}
        {shown.map((e) => (
          <ActivityItem key={e.id} code={code} e={e} onChanged={refresh} />
        ))}
      </div>
    </div>
  );

  const codeChip = (
    <div className="flex min-w-0 items-center gap-2 text-sm text-ink-subtle">
      <TypeIcon type={t.type} />
      <Link
        to={`/tickets/${t.code}`}
        title={t.system_name}
        className={`inline-flex h-6 shrink-0 items-center rounded border px-2 font-docno text-[12px] font-semibold hover:underline ${systemTagStyle(t.systemCode)}`}
      >
        {t.code}
      </Link>
      <span className="truncate text-xs">{t.system_name}</span>
    </div>
  );

  const errorBanner = error && (
    <div role="alert" className="rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">
      {error}
    </div>
  );

  if (variant === "panel") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="shrink-0 space-y-3 border-b border-line px-4 pb-4 pt-3 sm:px-6">
          <div className="flex items-center gap-2">
            {codeChip}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {/* The reply box sits below every detail section; this jumps straight to it. */}
              <button className="btn-default px-3" onClick={jumpToReply}>
                <MessageSquare className="h-4 w-4" /> Reply
              </button>
              <Link to={`/tickets/${t.code}`} className="btn-subtle px-2" title="Open full page" aria-label="Open full page">
                <Maximize2 className="h-4 w-4" />
              </Link>
              <button className="btn-subtle px-2" title="Close" aria-label="Close" onClick={onClose}>
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <h1 className="break-words text-[18px] font-extrabold leading-snug tracking-tight text-ink">{t.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {statusControls}
            <span className="ml-auto">{deleteButton}</span>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
          {errorBanner}
          {overview}
          {description}
          {properties}
          {timeline}
          {activity(
            <div ref={composerRef} className="scroll-mt-4">
              {composer}
            </div>,
          )}
        </div>
        {deleteDialog}
        {assignDialog}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <Link to="/tickets" className="tap inline-flex items-center gap-1 text-[13px] font-medium text-primary transition-colors duration-150 hover:underline">
          <ChevronLeft className="h-4 w-4" /> All tickets
        </Link>
        <span className="truncate text-[13px] text-ink-subtlest">/ {t.system_name}</span>
        <div className="ml-auto flex items-center gap-2">
          {/* The reply box sits below the description; this jumps straight to it. */}
          <button className="btn-default px-3 transition-colors duration-150" onClick={jumpToReply}>
            <MessageSquare className="h-4 w-4" /> Reply
          </button>
          {deleteButton}
        </div>
      </div>

      <div className="mb-6 max-w-4xl space-y-2">
        {codeChip}
        <h1 className="break-words text-[26px] font-extrabold leading-tight tracking-tight text-ink sm:text-[30px]">{t.title}</h1>
      </div>
      {errorBanner && <div className="mb-4 max-w-4xl">{errorBanner}</div>}

      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <main className="min-w-0 flex-1 space-y-6 xl:max-w-4xl">
          {description}
          {activity(
            <div ref={composerRef} className="scroll-mt-4">
              {composer}
            </div>,
          )}
        </main>
        <aside className="space-y-6 xl:sticky xl:top-6 xl:w-96 xl:shrink-0">
          {statusControls}
          {overview}
          {properties}
          {timeline}
        </aside>
      </div>
      {deleteDialog}
      {assignDialog}
    </div>
  );
}
