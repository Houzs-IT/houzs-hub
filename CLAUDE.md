# Houzs IT Hub: code rules

## Comments
- Write few comments. Clear names and small functions should explain the code.
- Only comment the "why" a reader cannot guess: a business rule, a workaround, a limit.
- One short line is usually enough. No comments that repeat what the code says.
- No commented-out code, no TODOs without a ticket.

## Names
- Use full, plain words: `ticket`, `reporter`, `attachment`, not `t`, `r`, `a`.
- Single letters only for tiny scopes (`i` in a loop, `e` for an event, `c` for the Hono context).
- Booleans read as yes/no: `isOpen`, `hasFiles`, `canDelete`.
- Functions start with a verb: `loadTickets`, `deleteTicket`, `showToast`.
- Name things the way the team talks about them in the UI (List, Board, My queue, Reporter, Assignee).
- Do not rename existing code just to follow these rules; apply them to code you write or change.
