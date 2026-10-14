import { ArrowRight, ChevronDown, ExternalLink, FileText, Lock, Maximize2, Paperclip, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, attachmentUrl, json, type Attachment, type Status, type TicketEvent, type TicketFull } from "../api/client";
import { fmtAgo, fmtDateTime, fmtSize, sla } from "../lib/format";
import { ACTIVE, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, STATUS_STYLE, TYPES, TYPE_LABEL } from "../lib/labels";
import { usePoll } from "../lib/usePoll";
import { Avatar, Lozenge, PriorityIcon, SystemTag, TypeIcon } from "./Bits";
import { useOutside } from "./FilterButton";
import ImageLightbox from "./ImageLightbox";
import { useHub } from "./Layout";

type Detail = { ticket: TicketFull; events: TicketEvent[] };

function Attachments({ items }: { items: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {viewing && <ImageLightbox src={attachmentUrl(viewing.id)} alt={viewing.filename} onClose={() => setViewing(null)} />}
      {items.map((a) =>
        a.mime.startsWith("image/") ? (
          <a
            key={a.id}
            href={attachmentUrl(a.id)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              // Ctrl/Cmd/Shift-click (and middle-click, which never fires onClick) still open the file in a new tab.
              if (e.ctrlKey || e.metaKey || e.shiftKey) return;
              e.preventDefault();
              setViewing(a);
            }}
            className="group block w-40 overflow-hidden rounded border border-line"
          >
            <img src={attachmentUrl(a.id)} alt={a.filename} className="h-24 w-full object-cover group-hover:opacity-90" />
            <div className="truncate border-t border-line px-2 py-1 text-xs text-ink-subtle">{a.filename}</div>
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

function StatusButton({ status, disabled, onChange }: { status: Status; disabled: boolean; onChange: (s: Status) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={`btn h-9 px-3.5 ${
          status === "in_progress" || status === "open"
            ? "border border-primary bg-primary text-primary-on shadow-sm hover:bg-primary-hover"
            : `${STATUS_STYLE[status]} hover:brightness-95`
        }`}
      >
        {STATUS_LABEL[status]}
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-30 min-w-[220px] rounded-[10px] bg-overlay py-1.5 shadow-overlay">
          {STATUSES.filter((s) => s !== status).map((s) => (
            <button
              key={s}
              onClick={() => {
                setOpen(false);
                onChange(s);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover"
            >
              <ArrowRight className="h-3.5 w-3.5 text-ink-subtlest" />
              <Lozenge status={s} />
            </button>
          ))}
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
  const label = (v: string | null) =>
    e.kind === "priority" ? PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? v : TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? v;
  return (
    <>
      changed the {e.kind === "priority" ? "Priority" : "Type"} from <b className="font-semibold">{label(e.fromValue)}</b> to{" "}
      <b className="font-semibold">{label(e.toValue)}</b>
    </>
  );
}

function ActivityItem({ e }: { e: TicketEvent }) {
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
          </div>
          <div className={`mt-1 rounded ${internal ? "border-l-4 border-note-line bg-note px-3 py-2" : ""}`}>
            {e.body && <div className="whitespace-pre-wrap text-sm leading-6">{e.body}</div>}
            <Attachments items={e.attachments} />
          </div>
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
        {e.body && <div className="mt-0.5 text-xs text-ink-subtlest">{e.body}</div>}
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
          <button className="font-medium text-primary hover:underline" onClick={() => setMode("public")}>
            Reply to reporter
          </button>
          <span className="mx-2">or</span>
          <button className="font-medium text-primary hover:underline" onClick={() => setMode("internal")}>
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
              className={`rounded px-2 py-1 text-xs font-semibold ${mode === m ? "bg-primary-soft text-primary" : "text-ink-subtle hover:bg-hover"}`}
            >
              {m === "public" ? "Reply to reporter" : "Add internal note"}
            </button>
          ))}
        </div>
        <div className={`rounded border-2 ${internal ? "border-note-line bg-note" : "border-primary bg-surface"}`}>
          <textarea
            autoFocus
            className="block h-28 w-full resize-y bg-transparent px-3 py-2 text-sm outline-none"
            placeholder={internal ? "Only developers can see internal notes" : "The reporter will see this in their system"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded bg-neutral px-2 py-0.5 text-xs">
                  {f.name}
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {error && <div className="mt-1 text-xs text-loz-red-ink">{error}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={busy || (!body.trim() && !files.length)} onClick={save}>
            Save
          </button>
          <button className="btn-subtle" onClick={reset}>
            Cancel
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf,video/mp4,video/quicktime"
            className="hidden"
            onChange={(e) => {
              setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 5));
              e.target.value = "";
            }}
          />
          <button className="btn-subtle px-2" title="Attach files" onClick={() => fileRef.current?.click()}>
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3 py-1.5">
      <div className="text-sm font-semibold text-ink-subtle">{label}</div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

export default function IssueView({ code, variant, onClose }: { code: string; variant: "panel" | "page"; onClose?: () => void }) {
  const { me, users, refresh, version } = useHub();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"all" | "comments" | "history">("all");
  const navigate = useNavigate();
  const confirmDelete = useRef<HTMLDialogElement>(null);

  const load = useCallback(() => {
    api<Detail>(`/tickets/${code}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [code]);

  useEffect(load, [load, version]);
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
    return <div className="p-8 text-sm text-ink-subtlest">{error ?? "Loading..."}</div>;
  }

  const { ticket: t, events } = data;
  const s = sla(t.createdAt, t.priority, t.status, t.legacyCode);
  const created = events.find((e) => e.kind === "created");
  const shown = events
    .filter((e) => e.kind !== "created" || tab !== "comments")
    .filter((e) => (tab === "comments" ? e.kind === "comment" : tab === "history" ? e.kind !== "comment" : true))
    .slice()
    .reverse();
  const assignee = users.find((d) => d.id === t.assigneeId);
  const canPickUp = ACTIVE.includes(t.status) && !t.assigneeId;

  const details = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusButton status={t.status} disabled={saving} onChange={(st) => patch({ status: st })} />
        {canPickUp && (
          <button className="btn-default" disabled={saving} onClick={() => patch({}, "/pickup")}>
            Pick up
          </button>
        )}
        {me.perms?.includes("delete_tickets") && (
          <button className="btn-subtle ml-auto text-loz-red-ink" disabled={saving} onClick={() => confirmDelete.current?.showModal()}>
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
      </div>

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

      <div className="card">
        <div className="section-title border-b border-line px-4 py-3">Details</div>
        <div className="px-4 py-2">
          <Row label="Assignee">
            <div className="flex items-center gap-2">
              <Avatar name={assignee?.name} size={24} />
              <select
                className="inline-select"
                value={t.assigneeId ?? ""}
                disabled={saving}
                onChange={(e) => patch({ assignee_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Unassigned</option>
                {users.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            {t.assigneeId !== me.id && (
              <button className="ml-8 text-xs font-medium text-primary hover:underline" onClick={() => patch({ assignee_id: me.id })}>
                Assign to me
              </button>
            )}
          </Row>
          <Row label="Reporter">
            <div className="flex items-center gap-2">
              <Avatar name={t.reporterName} size={24} />
              <span className="truncate">{t.reporterName}</span>
            </div>
            <div className="ml-8 space-y-0.5 text-xs text-ink-subtle">
              {t.reporterDepartment && <div>{t.reporterDepartment}</div>}
              {t.reporterPhone && (
                <a
                  className="block text-primary hover:underline"
                  href={`https://wa.me/${t.reporterPhone.replace(/\D/g, "").replace(/^0/, "60")}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.reporterPhone}
                </a>
              )}
              {t.reporterEmail && (
                <a className="block truncate text-primary hover:underline" href={`mailto:${t.reporterEmail}`}>
                  {t.reporterEmail}
                </a>
              )}
            </div>
          </Row>
          <Row label="System">
            <div className="flex items-center gap-2">
              <SystemTag code={t.systemCode} /> {t.system_name}
            </div>
          </Row>
          <Row label="Priority">
            <div className="flex items-center gap-1.5">
              <PriorityIcon priority={t.priority} />
              <select className="inline-select" value={t.priority} disabled={saving} onChange={(e) => patch({ priority: e.target.value })}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
          </Row>
          <Row label="Type">
            <div className="flex items-center gap-1.5">
              <TypeIcon type={t.type} />
              <select className="inline-select" value={t.type} disabled={saving} onChange={(e) => patch({ type: e.target.value })}>
                {TYPES.map((x) => (
                  <option key={x} value={x}>
                    {TYPE_LABEL[x]}
                  </option>
                ))}
              </select>
            </div>
          </Row>
          {s && (
            <Row label="SLA">
              <span className={`font-medium ${s.overdue ? "text-loz-red-ink" : "text-ink"}`}>{s.label}</span>
            </Row>
          )}
          <Row label="Occurred">{fmtDateTime(t.occurredAt)}</Row>
          {t.pageUrl && (
            <Row label="Page">
              <a className="inline-flex max-w-full items-center gap-1 text-primary hover:underline" href={t.pageUrl} target="_blank" rel="noreferrer">
                <span className="truncate">{t.pageUrl}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </Row>
          )}
          {(t.appVersion || t.userAgent) && (
            <Row label="Client">
              <span className="block truncate text-xs text-ink-subtle" title={t.userAgent ?? ""}>
                {t.appVersion ? `v${t.appVersion} ` : ""}
                {t.userAgent}
              </span>
            </Row>
          )}
          {t.legacyCode && <Row label="Sheet ID">{t.legacyCode}</Row>}
        </div>
      </div>

      <div className="space-y-0.5 text-xs text-ink-subtlest">
        <div>Created {fmtDateTime(t.createdAt)}</div>
        <div>Updated {fmtDateTime(t.updatedAt)}</div>
        {t.pickedUpAt && <div>Picked up {fmtDateTime(t.pickedUpAt)}</div>}
        {t.resolvedAt && <div>Done {fmtDateTime(t.resolvedAt)}</div>}
        {t.closedAt && <div>Closed {fmtDateTime(t.closedAt)}</div>}
      </div>
    </div>
  );

  const main = (
    <div className="space-y-6">
      <div>
        <div className="section-title mb-2">Description</div>
        <div className="whitespace-pre-wrap text-sm leading-6">{t.description || <span className="text-ink-subtlest">No description</span>}</div>
      </div>

      {created && created.attachments.length > 0 && (
        <div>
          <div className="section-title mb-1">Attachments ({created.attachments.length})</div>
          <Attachments items={created.attachments} />
        </div>
      )}

      <div>
        <div className="section-title mb-2">Activity</div>
        <div className="mb-4 flex items-center gap-1 text-sm">
          <span className="mr-1 text-ink-subtle">Show:</span>
          {(["all", "comments", "history"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded px-2 py-1 font-medium ${tab === k ? "bg-primary-soft text-primary" : "text-ink-subtle hover:bg-hover"}`}
            >
              {k === "all" ? "All" : k === "comments" ? "Comments" : "History"}
            </button>
          ))}
        </div>
        <div className="space-y-5">
          <Composer code={code} status={t.status} onDone={refresh} />
          {shown.map((e) => (
            <ActivityItem key={e.id} e={e} />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className={variant === "panel" ? "flex h-full flex-col" : ""}>
      <div className={`flex items-center gap-2 ${variant === "panel" ? "border-b border-line px-4 py-3 md:px-6" : "mb-4"}`}>
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-ink-subtle">
          <SystemTag code={t.systemCode} />
          <span>/</span>
          <TypeIcon type={t.type} />
          <Link to={`/tickets/${t.code}`} className="font-docno text-[12.5px] font-semibold text-accent hover:underline">
            {t.code}
          </Link>
        </div>
        {variant === "panel" && (
          <div className="ml-auto flex items-center gap-1">
            <Link to={`/tickets/${t.code}`} className="btn-subtle px-2" title="Open full page">
              <Maximize2 className="h-4 w-4" />
            </Link>
            <button className="btn-subtle px-2" title="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className={variant === "panel" ? "flex-1 overflow-y-auto overscroll-contain px-4 py-5 md:px-6" : ""}>
        <h1 className={`mb-5 font-extrabold tracking-tight text-ink ${variant === "panel" ? "text-[20px]" : "text-[24px]"}`}>{t.title}</h1>
        {error && <div className="mb-4 rounded bg-loz-red px-3 py-2 text-sm text-loz-red-ink">{error}</div>}
        {variant === "panel" ? (
          <div className="space-y-6">
            {details}
            {main}
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            {main}
            <div className="lg:sticky lg:top-6 lg:self-start">{details}</div>
          </div>
        )}
      </div>
    </div>
  );
}
