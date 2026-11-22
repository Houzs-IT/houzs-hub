// End-to-end check of /api/v1/sys/meetings against `wrangler dev --port 8799` and the throwaway
// Postgres from the README. Issue two local keys first (npm run key:issue -- HC, then HK).
// Usage: node scripts/meetings-e2e.mjs <HC key> <HK key>   (never against production)
const [HC, HK] = process.argv.slice(2);
const BASE = "http://127.0.0.1:8799/api/v1/sys/meetings";
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) fails++; };
const call = async (key, who, method, path, body, extra = {}) => {
  const h = { Authorization: `Bearer ${key}`, "X-Reporter-Id": who.id, "Content-Type": "application/json", ...extra };
  if (who.name) Object.assign(h, { "X-Person-Name": who.name, "X-Person-Email": who.email ?? "", "X-Person-Company": who.company ?? "", "X-Person-Department": who.dept ?? "" });
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};
const lim = { id: "1", name: "Lim", email: "lim@example.com", company: "Houzs Century", dept: "Management" };
const hana = { id: "2", name: "Hana", email: "hana@example.com", company: "Houzs Century", dept: "Operation" };
const ivy = { id: "77", name: "Ivy", email: "ivy@example.com", company: "Hookka", dept: "Purchasing" };
const mgr = { "X-Can-Manage-Rooms": "1" };

// Next Tuesday 10:00 local (+08:00).
const d = new Date(Date.now() + 8 * 3600e3); let add = (9 - d.getUTCDay()) % 7 || 7;
const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add)).toISOString().slice(0, 10);
const T = (h, m = 0) => `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`;

let r = await call(HC, { id: "system" }, "PUT", "/directory", { people: [
  { id: "1", name: "Lim", email: "lim@example.com", company: "Houzs Century", department: "Management" },
  { id: "2", name: "Hana", email: "hana@example.com", company: "Houzs Century", department: "Operation" },
  { id: "3", name: "Dexon", email: "", company: "Houzs Century", department: "Operation" } ] });
ok(r.status === 200 && r.j.received === 3, `directory push (${r.status} ${JSON.stringify(r.j)})`);
r = await call(HK, { id: "system" }, "PUT", "/directory", { people: [{ id: "77", name: "Ivy", email: "IVY@example.com", company: "Hookka", department: "Purchasing" }] });
ok(r.status === 200, "directory push from Hookka");

r = await call(HC, hana, "POST", "/rooms", { name: "Boardroom", seats: 12 });
ok(r.status === 403, "room add refused without Manage meeting rooms");
r = await call(HC, lim, "POST", "/rooms", { name: "Boardroom", location: "Head office", floor: "Level 2", seats: 12, equipment: ["TV", "Video call"], days: [1,2,3,4,5,6], openFrom: 9, openTo: 18, bufferMin: 15, maxHours: 4, advanceDays: 90 }, mgr);
ok(r.status === 201, `room added (${r.status})`); const boardroom = r.j.id;
r = await call(HC, lim, "POST", "/rooms", { name: "Room 1", location: "Head office", seats: 6, closures: [{ from: day, to: day, reason: "repaint" }] }, mgr);
const room1 = r.j.id;

r = await call(HC, lim, "GET", "/bootstrap");
ok(r.status === 200 && r.j.rooms.length === 2 && r.j.people.some((p) => p.key === "ivy@example.com") && r.j.people.some((p) => p.key === "HC:3"), `bootstrap: rooms + directory across systems (${r.j?.people?.length} people)`);

r = await call(HC, lim, "POST", "/meetings", { title: "Weekly sales review", start: T(10), end: T(11), roomId: boardroom, attendees: ["hana@example.com", "ivy@example.com"] });
ok(r.status === 201 && r.j.created === 1, `booked meeting (${r.status} ${JSON.stringify(r.j)})`); const m1 = r.j.ids?.[0];

r = await call(HK, ivy, "POST", "/meetings", { title: "Supplier call", start: T(10, 30), end: T(11, 30), attendees: [] });
ok(r.status === 409 && r.j.conflict.people.length === 1 && r.j.conflict.people[0].key === "ivy@example.com", `person busy blocked from another ERP (${r.status})`);

r = await call(HC, hana, "POST", "/meetings", { title: "Ops", start: T(11, 5), end: T(11, 45), roomId: boardroom, attendees: [] });
ok(r.status === 409 && r.j.conflict.room, `15-minute gap after a booking is enforced (${r.status})`);

r = await call(HC, hana, "POST", "/meetings", { title: "Ops", start: T(12), end: T(13), roomId: room1, attendees: [] });
ok(r.status === 409 && r.j.conflict.rules.some((x) => x.includes("closed")), `closed date blocks (${JSON.stringify(r.j?.conflict?.rules)})`);

r = await call(HC, hana, "POST", "/meetings", { title: "Long", start: T(12), end: T(17, 30), roomId: boardroom, attendees: [] });
ok(r.status === 409 && r.j.conflict.rules.some((x) => x.includes("at most 4 hours")), "max hours rule");

r = await call(HC, hana, "POST", "/meetings", { title: "Clash", start: T(10, 15), end: T(10, 45), roomId: boardroom, attendees: [] });
ok(r.status === 409 && r.j.suggestTime, `room taken gives a suggested time (${r.j?.suggestTime})`);

r = await call(HK, ivy, "GET", "/mine");
ok(r.status === 200 && r.j.meetings.some((m) => m.id === m1) && r.j.notifications.some((n) => n.text.includes("Lim invited you")), "Ivy (Hookka) sees the invite and the notification");

r = await call(HC, hana, "PATCH", `/meetings/${m1}`, { start: T(14), end: T(15) });
ok(r.status === 403, "only the organiser can move it");
r = await call(HC, lim, "PATCH", `/meetings/${m1}`, { start: T(14), end: T(15) });
ok(r.status === 200 && r.j.changed === 1, `organiser moved it (${r.status} ${JSON.stringify(r.j)})`);
r = await call(HC, lim, "GET", `/meetings/${m1}`);
ok(r.j.history.length >= 2 && r.j.history.some((h) => h.text.startsWith("moved it")), "history recorded");

r = await call(HC, lim, "POST", "/meetings", { title: "Stand-up", start: T(9), end: T(9, 30), roomId: boardroom, attendees: ["hana@example.com"], repeat: "daily", repeatUntil: day.slice(0, 8) + String(Number(day.slice(8)) + 3).padStart(2, "0") });
ok(r.status === 201 && r.j.created >= 3, `repeat series (${JSON.stringify(r.j)})`);

r = await call(HC, lim, "POST", "/links", { name: "Showroom visits", rooms: [boardroom], length: 60, days: [0,1,2,3,4,5,6], from: 10, to: 17, hosts: ["lim@example.com"], until: null });
ok(r.status === 201, "guest link created with no end date"); const code = r.j.code;
r = await call(HC, { id: "guest" }, "GET", "/calendar?from=" + encodeURIComponent(T(0)) + "&to=" + encodeURIComponent(T(23)));
ok(r.status === 403, "guest cannot read the calendar");
r = await call(HC, { id: "guest" }, "GET", `/public/links/${code}/slots?day=${day}`);
ok(r.status === 200 && r.j.slots.length > 0 && !r.j.slots.some((s) => s.start === new Date(T(14)).toISOString()), `guest slots skip taken times (${r.j?.slots?.length})`);
const slot = r.j.slots[0];
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code}/book`, { start: slot.start, name: "Mr Lee", phone: "+60 12-345 6789", email: "lee@example.com" });
ok(r.status === 201 && r.j.token, `guest booked (${r.status})`); const token = r.j.token;
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code}/book`, { start: slot.start, name: "Other", phone: "1", email: "x@example.com" });
ok(r.status === 409, "same slot cannot be taken twice");
r = await call(HC, { id: "guest" }, "GET", `/public/bookings/${token}`);
ok(r.status === 200 && r.j.booking.room === "Boardroom", "guest sees own booking");
r = await call(HC, { id: "guest" }, "POST", `/public/bookings/${token}/cancel`);
ok(r.status === 200, "guest cancelled");

r = await call(HC, lim, "POST", `/meetings/${m1}/end`);
ok(r.status === 200, "organiser ended it (future meeting ends at once)");
r = await call(HC, lim, "GET", "/calendar?from=" + encodeURIComponent(T(0)) + "&to=" + encodeURIComponent(T(23)));
ok(r.status === 200 && r.j.meetings.find((m) => m.id === m1)?.status === "ended", "calendar shows it ended");
r = await call(HC, lim, "GET", "/log", undefined, mgr);
ok(r.status === 200 && r.j.log.length >= 3, "change log");

// Two saves of the same slot at the same moment: exactly one wins.
const both = await Promise.all([
  call(HC, hana, "POST", "/meetings", { title: "Race A", start: T(16), end: T(17), roomId: room1, attendees: [] }),
  call(HC, lim, "POST", "/meetings", { title: "Race B", start: T(16), end: T(17), roomId: room1, attendees: [] }),
]);
// room1 is closed that day, so use the next day instead for the race.
const day2 = new Date(Date.parse(day) + 86400e3).toISOString().slice(0, 10);
const T2 = (h) => `${day2}T${String(h).padStart(2, "0")}:00:00+08:00`;
const race = await Promise.all([
  call(HC, hana, "POST", "/meetings", { title: "Race A", start: T2(16), end: T2(17), roomId: room1, attendees: [] }),
  call(HC, { ...lim }, "POST", "/meetings", { title: "Race B", start: T2(16), end: T2(17), roomId: room1, attendees: [] }),
]);
ok(race.filter((x) => x.status === 201).length === 1 && race.filter((x) => x.status === 409).length === 1, `simultaneous saves: one wins (${race.map((x) => x.status)})`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
