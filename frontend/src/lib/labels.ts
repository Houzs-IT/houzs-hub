import type { Priority, Status, TicketRow, TicketType } from "../api/client";

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "On Going",
  on_hold: "On Hold",
  testing: "Testing",
  waiting_reporter: "Waiting Reporter",
  resolved: "Done",
  closed: "Closed",
  rejected: "Rejected",
};

export const STATUS_STYLE: Record<Status, string> = {
  open: "bg-loz-grey text-loz-grey-ink",
  in_progress: "bg-loz-blue text-loz-blue-ink",
  on_hold: "bg-loz-yellow text-loz-yellow-ink",
  testing: "bg-loz-purple text-loz-purple-ink",
  waiting_reporter: "bg-loz-orange text-loz-orange-ink",
  resolved: "bg-loz-green text-loz-green-ink",
  closed: "bg-loz-grey text-loz-grey-ink",
  rejected: "bg-loz-red text-loz-red-ink",
};

export const STATUS_COLUMN_STYLE: Record<Status, string> = {
  open: "border-loz-grey-ink/25 bg-loz-grey/70",
  in_progress: "border-loz-blue-ink/25 bg-loz-blue/70",
  on_hold: "border-loz-yellow-ink/25 bg-loz-yellow/70",
  testing: "border-loz-purple-ink/25 bg-loz-purple/70",
  waiting_reporter: "border-loz-orange-ink/25 bg-loz-orange/70",
  resolved: "border-loz-green-ink/25 bg-loz-green/70",
  closed: "border-loz-grey-ink/25 bg-loz-grey/70",
  rejected: "border-loz-red-ink/25 bg-loz-red/70",
};

export const STATUS_DOT_STYLE: Record<Status, string> = {
  open: "bg-loz-grey-ink",
  in_progress: "bg-loz-blue-ink",
  on_hold: "bg-loz-yellow-ink",
  testing: "bg-loz-purple-ink",
  waiting_reporter: "bg-loz-orange-ink",
  resolved: "bg-loz-green-ink",
  closed: "bg-loz-grey-ink",
  rejected: "bg-loz-red-ink",
};

export const STATUS_HINT: Record<Status, string> = {
  open: "New, not picked up yet",
  in_progress: "Being worked on",
  on_hold: "Paused for now",
  testing: "Fix ready, being checked",
  waiting_reporter: "Needs an answer from the reporter",
  resolved: "Fixed and finished",
  closed: "No more work needed",
  rejected: "Will not be done",
};

const SYSTEM_TAG_STYLES = [
  "border-loz-blue-ink/40 bg-loz-blue text-loz-blue-ink",
  "border-loz-green-ink/40 bg-loz-green text-loz-green-ink",
  "border-loz-yellow-ink/40 bg-loz-yellow text-loz-yellow-ink",
  "border-loz-orange-ink/40 bg-loz-orange text-loz-orange-ink",
  "border-loz-purple-ink/40 bg-loz-purple text-loz-purple-ink",
  "border-loz-red-ink/40 bg-loz-red text-loz-red-ink",
] as const;

// Same code always gets the same colour, so a system is recognisable at a glance on every page.
export function systemTagStyle(code: string): string {
  const codeSum = [...code].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return SYSTEM_TAG_STYLES[codeSum % SYSTEM_TAG_STYLES.length];
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const PRIORITY_DOT_STYLE: Record<Priority, string> = {
  high: "bg-loz-red-ink",
  medium: "bg-loz-yellow-ink",
  low: "bg-loz-blue-ink",
};

export const TYPE_LABEL: Record<TicketType, string> = {
  bug: "Bug",
  development: "Development",
};

export const STATUSES = Object.keys(STATUS_LABEL) as Status[];
export const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];
export const TYPES = Object.keys(TYPE_LABEL) as TicketType[];
export const ACTIVE: Status[] = ["open", "in_progress", "on_hold", "testing", "waiting_reporter"];

// SLA: hours from submitted to done, per priority, not counting time in Waiting Reporter.
// Set by Lim 2026-11-02 (the recommended defaults); change them here.
export const SLA_HOURS: Record<Priority, number> = { high: 24, medium: 72, low: 168 };

// The reporter spoke last on a ticket someone is already working.
export const isReporterWaiting = (ticket: TicketRow) =>
  ticket.last_public_actor === "reporter" && ticket.status !== "open" && ACTIVE.includes(ticket.status);
export const BOARD_COLUMNS: Status[] = ["open", "in_progress", "on_hold", "testing", "waiting_reporter", "resolved"];
