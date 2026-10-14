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

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const TYPE_LABEL: Record<TicketType, string> = {
  bug: "Bug",
  development: "Development",
};

export const STATUSES = Object.keys(STATUS_LABEL) as Status[];
export const PRIORITIES = Object.keys(PRIORITY_LABEL) as Priority[];
export const TYPES = Object.keys(TYPE_LABEL) as TicketType[];
export const ACTIVE: Status[] = ["open", "in_progress", "on_hold", "testing", "waiting_reporter"];

// The reporter spoke last on a ticket someone is already working.
export const isReporterWaiting = (ticket: TicketRow) =>
  ticket.last_public_actor === "reporter" && ticket.status !== "open" && ACTIVE.includes(ticket.status);
export const BOARD_COLUMNS: Status[] = ["open", "in_progress", "on_hold", "testing", "waiting_reporter", "resolved"];
// On Hold is parked on purpose, so it does not burn SLA.
export const SLA_RUNNING: Status[] = ["open", "in_progress", "testing", "waiting_reporter"];

// Target hours to resolve, by priority. Placeholder until the team agrees SLA.
export const SLA_HOURS: Record<Priority, number> = { urgent: 4, high: 24, medium: 72, low: 168 };
