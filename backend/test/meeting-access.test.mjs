// Meeting access rules (src/services/meetings.ts), audit 2026-11-28.
// B1: the files, notes and history of a meeting held in a room could be read by anyone in
// any connected system, because "room bookings are visible to all" was also the rule for
// its content. B2: two bookings sharing a person (an online meeting has no room) were not
// serialised. Run: npm --prefix backend test (Node 22.18+ loads .ts directly).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  forViewer,
  inMeeting,
  mayChangeMeeting,
  mayReadMeetingContent,
  maySeeMeeting,
  personLockKeys,
} from "../src/services/meetings.ts";

const roomHr = { organizer: "HOOKKA:hr1", booked_by: "HOOKKA:hr1", room_id: 3, people: ["HOOKKA:staff9"] };
const online = { organizer: "HOUZS:a", booked_by: "HOUZS:b", room_id: null, people: ["HOUZS:c"] };

test("a room booking stays visible to everyone (the room calendar)", () => {
  assert.equal(maySeeMeeting(roomHr, "CONTS:someone"), true);
  assert.equal(maySeeMeeting(online, "CONTS:someone"), false);
  assert.equal(maySeeMeeting(online, "HOUZS:c"), true);
});

test("B1: files, notes and history only for the people in the meeting", () => {
  for (const who of ["HOOKKA:hr1", "HOOKKA:staff9"]) assert.equal(mayReadMeetingContent(roomHr, who), true, who);
  assert.equal(mayReadMeetingContent({ ...roomHr, booked_by: "HOOKKA:pa" }, "HOOKKA:pa"), true, "the booker");
  for (const who of ["CONTS:someone", "HOOKKA:other", "HOUZS:a"]) assert.equal(mayReadMeetingContent(roomHr, who), false, `${who} sees the slot, not the files`);
  assert.equal(mayReadMeetingContent, inMeeting, "the same rule the page uses for adding files");
});

test("B1: someone outside sees the slot without its notes", () => {
  const pub = { id: 1, title: "Disciplinary hearing", notes: "Confidential: see attached warning letter" };
  assert.equal(forViewer(pub, true).notes, pub.notes);
  const out = forViewer(pub, false);
  assert.equal(out.notes, null);
  assert.equal(out.title, pub.title, "the slot itself is unchanged");
  assert.equal(pub.notes, "Confidential: see attached warning letter", "the original is not mutated");
});

test("only the organiser or booker may change", () => {
  assert.equal(mayChangeMeeting(online, "HOUZS:a"), true);
  assert.equal(mayChangeMeeting(online, "HOUZS:b"), true);
  assert.equal(mayChangeMeeting(online, "HOUZS:c"), false);
});

test("B2: person locks are deduped and in one fixed order", () => {
  assert.deepEqual(personLockKeys(["b", "a", "b", ""]), ["hub-meeting-person:a", "hub-meeting-person:b"]);
  assert.deepEqual(personLockKeys(["a", "b"]), personLockKeys(["b", "a"]), "same order whoever books first");
});

test("the routes use these rules (source pins)", () => {
  const src = fs.readFileSync(new URL("../src/routes/sysMeetings.ts", import.meta.url), "utf8");
  const dl = src.slice(src.indexOf('app.get("/meetings/:id{[0-9]+}/files/:fid{[0-9]+}"'));
  assert.match(dl.slice(0, dl.indexOf("\n});")), /inMeetingSql\(key\)/, "the file download needs a person in the meeting");
  assert.doesNotMatch(dl.slice(0, dl.indexOf("\n});")), /visibleTo\(key\)/, "not merely someone who can see the room booking");
  const detail = src.slice(src.indexOf('app.get("/meetings/:id{[0-9]+}", '));
  assert.match(detail.slice(0, detail.indexOf("\n});")), /mayReadMeetingContent\(m, actor\)/, "the detail hides files, notes and history from outsiders");
  const post = src.slice(src.indexOf('app.post("/meetings", '));
  assert.match(post.slice(0, post.indexOf("\n});")), /lockRoom\(tx, d\.roomId\);\s*await lockPeople\(tx, people\);/, "a new booking locks its room, then its people");
  const patch = src.slice(src.indexOf('app.patch("/meetings/:id{[0-9]+}"'));
  assert.match(patch.slice(0, patch.indexOf("\n});")), /await lockPeople\(tx, people\);/, "a change locks its people");
});
