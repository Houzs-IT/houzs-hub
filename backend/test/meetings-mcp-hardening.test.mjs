// R&D 2026-11-27 #3, #4, #9: meeting file types, room-meeting details, MCP batch cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { busyMeeting, safeMime } from "../src/services/meetings.ts";
import { MAX_BATCH } from "../src/services/mcp-round3.ts";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("#3 only png, jpeg and pdf keep their type; anything else is a plain download", () => {
  assert.equal(safeMime("image/png"), "image/png");
  assert.equal(safeMime("IMAGE/JPEG"), "image/jpeg");
  assert.equal(safeMime("application/pdf"), "application/pdf");
  for (const t of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "", null, undefined]) assert.equal(safeMime(t), "application/octet-stream");
  const s = src("../src/routes/sysMeetings.ts");
  assert.match(s, /contentType: safeMime\(f\.type\)/);
  assert.match(s, /"Content-Type": safeMime\(f\.mime_type\)/);
});

test("#4 a room booking shows only busy to people not in it; files and links stay inside", () => {
  const m = {
    id: 7, title: "Pay review", starts_at: new Date("2026-11-27T02:00:00Z"), ends_at: new Date("2026-11-27T03:00:00Z"), room_id: 3,
    organizer: "hc:1", booked_by: "hc:1", notes: "secret", video_type: "meet", video_url: "https://meet/x", reminders: [], status: "scheduled",
    started_at: null, ended_at: null, series_id: null, created_in: "HC", link_id: 9, guest: { name: "Ann", phone: "012", email: "a@x", company: "X" }, guest_emails: ["b@y"],
  };
  const b = busyMeeting(m, Date.parse("2026-11-27T00:00:00Z"));
  assert.deepEqual([b.id, b.start, b.end, b.roomId, b.status], [7, "2026-11-27T02:00:00.000Z", "2026-11-27T03:00:00.000Z", 3, "scheduled"]);
  const leaked = JSON.stringify(b);
  for (const v of ["Pay review", "hc:1", "secret", "meet/x", "Ann", "012", "a@x", "b@y", "HC"]) assert.ok(!leaked.includes(v), `busy shape leaks ${v}`);
  const s = src("../src/routes/sysMeetings.ts");
  assert.match(s, /isIn\(m, key\) \? publicMeeting\(m, now\) : busyMeeting\(m, now\)/);
  assert.match(s, /if \(!isIn\(m, actor\)\) return c\.json\(\{ meeting: busyMeeting/);
  assert.match(s, /m\.status <> 'cancelled' AND \$\{inMeeting\(key\)\}/);
  assert.match(s, /FROM meeting_links WHERE created_in = \$\{c\.get\("systemCode"\)\}/);
});

test("#9 a JSON-RPC batch is capped and each call is logged before the next is counted", () => {
  assert.equal(MAX_BATCH, 10);
  const s = src("../src/routes/mcp.ts");
  assert.match(s, /if \(msgs\.length > MAX_BATCH\) return c\.json\(/);
  assert.match(s, /await logCall\(store,/);
  assert.doesNotMatch(s, /waitUntil\(done\)/);
});
