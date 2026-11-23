// End-to-end check of /api/v1/sys/meetings against `wrangler dev --port 8799` and the throwaway
// Postgres from the README. Issue two local keys first (npm run key:issue -- HC, then HK).
// Optional: an IT Support login (npm run user:set -- it@example.com itname, then clear must_change_password on the
// throwaway database) checks /api/v1/meetings with a session.
// Usage: node scripts/meetings-e2e.mjs <HC key> <HK key> [<IT login> <IT password>]   (never against production)
const [HC, HK, IT_LOGIN, IT_PASSWORD] = process.argv.slice(2);
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

// Second link shape (2026-11-23): the guest picks the room and the time range; hosts are optional.
r = await call(HC, lim, "POST", "/links", { name: "Visitors", rooms: [boardroom, room1], length: 120, days: [0,1,2,3,4,5,6], from: 8, to: 20, hosts: [], until: null, audience: "anyone" });
ok(r.status === 201, `link with no hosts accepted (${r.status} ${JSON.stringify(r.j)})`); const code2 = r.j.code;
r = await call(HC, { id: "guest" }, "GET", `/public/links/${code2}`);
ok(r.status === 200 && r.j.link.rooms.length === 2 && r.j.link.maxMinutes === 120 && r.j.link.audience === "anyone" && r.j.companies.some((x) => x.name === "Hookka" && x.departments.includes("Purchasing")), "guest gets the rooms, the longest booking and our company / department names");
ok(!JSON.stringify(r.j).includes("lim@example.com") && !JSON.stringify(r.j).includes("Lim"), "no person's name or email reaches the guest");
const dayB = new Date(Date.parse(day) + 86400e3).toISOString().slice(0, 10); // room1 is open that day (closed on `day`)
const TB = (h, m = 0) => `${dayB}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`;
r = await call(HC, { id: "guest" }, "GET", `/public/links/${code2}/day?day=${day}`);
const bd = r.j?.rooms?.find((x) => x.id === boardroom), r1d = r.j?.rooms?.find((x) => x.id === room1);
ok(r.status === 200 && r.j.open && bd.busy.length > 0 && !JSON.stringify(r.j).includes("Weekly") && r1d.closed === "repaint", `day view: busy times without titles, closed room marked (${JSON.stringify(r1d)})`);
const g = { name: "Ms Tan", phone: "+60 11-222 3333", email: "tan@abc.example", company: "ABC Trading", department: "", title: "Supplier intro", people: 4 };
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code2}/book`, { ...g, roomId: room1, start: TB(10), end: TB(11, 30) });
ok(r.status === 201 && r.j.token && r.j.booking.room.name === "Room 1", `guest picked room and range (${r.status} ${JSON.stringify(r.j)})`); const token2 = r.j.token;
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code2}/book`, { ...g, email: "other@abc.example", phone: "9", roomId: room1, start: TB(11), end: TB(12) });
ok(r.status === 409 && /taken/.test(r.j.error), `overlap refused with a sentence (${r.j?.error})`);
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code2}/book`, { ...g, email: "b@abc.example", phone: "8", roomId: room1, start: TB(13), end: TB(15, 30) });
ok(r.status === 400 && /at most 2 hours/.test(r.j.error), `longer than the link allows is refused (${r.j?.error})`);
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code2}/book`, { ...g, email: "c@abc.example", phone: "7", people: 9, roomId: room1, start: TB(13), end: TB(14) });
ok(r.status === 400 && /seats 6/.test(r.j.error), `too many people for the room is refused (${r.j?.error})`);
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code2}/book`, { ...g, email: "d@abc.example", phone: "6", title: "", roomId: room1, start: TB(13), end: TB(14) });
ok(r.status === 400 && /title/.test(r.j.error), "a title is required");
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code2}/book`, { ...g, email: "e@abc.example", phone: "5", roomId: room1, start: TB(7), end: TB(8) });
ok(r.status === 400 && /open 8:00 to 20:00/.test(r.j.error), `outside the link's hours is refused (${r.j?.error})`);
r = await call(HC, { id: "guest" }, "GET", `/public/bookings/${token2}`);
ok(r.status === 200 && r.j.booking.title === "Supplier intro" && r.j.booking.people === 4, "guest sees their own booking with title and people");
r = await call(HC, lim, "GET", `/calendar?from=${encodeURIComponent(TB(0))}&to=${encodeURIComponent(TB(23))}`);
ok(r.j.meetings.some((m) => m.title === "Supplier intro" && m.guest?.company === "ABC Trading"), "staff see the guest booking with the company on the calendar");
// Staff-only link: the company must be one of ours.
r = await call(HC, lim, "POST", "/links", { name: "Staff without ERP", rooms: [room1], length: 60, days: [0,1,2,3,4,5,6], from: 8, to: 20, hosts: ["lim@example.com"], until: null, audience: "staff" });
const code3 = r.j.code;
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code3}/book`, { ...g, email: "f@abc.example", phone: "4", roomId: room1, start: TB(12), end: TB(13) });
ok(r.status === 400 && /for our staff/.test(r.j.error), "staff-only link refuses an outside company");
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code3}/book`, { ...g, email: "g@abc.example", phone: "3", company: "Hookka", department: "Purchasing", roomId: room1, start: TB(12), end: TB(13) });
ok(r.status === 201, `staff-only link takes one of our companies (${r.status} ${JSON.stringify(r.j)})`);
r = await call(HC, lim, "GET", "/mine");
ok(r.j.notifications.some((n) => n.text.includes("booked Room 1 through the link Staff without ERP")), "the link's host is told");
// A link made with nothing preset: every room, every day, each room's own hours (owner, 2026-11-23).
r = await call(HC, lim, "POST", "/links", { until: null });
ok(r.status === 201, `link with nothing preset accepted (${r.status} ${JSON.stringify(r.j)})`); const code4 = r.j.code;
r = await call(HC, { id: "guest" }, "GET", `/public/links/${code4}`);
ok(r.status === 200 && r.j.link.rooms.length === 2 && r.j.link.name.startsWith("Booking link") && r.j.link.rooms.find((x) => x.id === boardroom)?.openFrom === 9, "it offers every room with its own opening hours, and gets a default name");
r = await call(HC, { id: "guest" }, "GET", `/public/links/${code4}/day?day=${dayB}`);
const bdB = r.j.rooms.find((x) => x.id === boardroom);
ok(bdB.from === 9 * 60 && bdB.to === 18 * 60 && bdB.closed === null, `day view gives the room's own window (${bdB.from}-${bdB.to})`);
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code4}/book`, { ...g, email: "h@abc.example", phone: "2", roomId: boardroom, start: TB(18), end: TB(19) });
ok(r.status === 400 && /open 9:00 to 18:00/.test(r.j.error), `a guest cannot book outside the room's hours (${r.j?.error})`);
r = await call(HC, { id: "guest" }, "POST", `/public/links/${code4}/book`, { ...g, email: "i@abc.example", phone: "1", roomId: boardroom, start: TB(15), end: TB(16) });
ok(r.status === 201, `and can inside them (${r.status} ${JSON.stringify(r.j)})`);

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

// IT Support's own users: the session vouches for the person; headers from the browser are ignored.
if (IT_LOGIN) {
  const ROOT = "http://127.0.0.1:8799/api/v1";
  const login = await fetch(`${ROOT}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login: IT_LOGIN, password: IT_PASSWORD }) });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  ok(login.status === 200 && cookie.startsWith("hub_session="), `IT Support login (${login.status})`);
  const it = async (method, path, body, extra = {}) => {
    const res = await fetch(`${ROOT}/meetings${path}`, { method, headers: { Cookie: cookie, "Content-Type": "application/json", ...extra }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await res.json(); } catch {}
    return { status: res.status, j };
  };
  let x = await fetch(`${ROOT}/meetings/bootstrap`);
  ok(x.status === 401, "no session, no meetings");
  // Spoofed headers: another person, another company, room rights. All must be ignored.
  x = await it("GET", "/bootstrap", undefined, { "X-Reporter-Id": "1", "X-Person-Email": "lim@example.com", "X-Person-Company": "Hookka", "X-Can-Manage-Rooms": "1" });
  const itKey = IT_LOGIN.includes("@") ? IT_LOGIN.toLowerCase() : null;
  ok(x.status === 200 && x.j.rooms.length === 2 && x.j.canManage === false && (!itKey || x.j.me === itKey), `IT bootstrap as the session's user, spoofed headers ignored (me=${x.j?.me}, canManage=${x.j?.canManage})`);
  const itPerson = x.j.people.find((p) => p.key === x.j.me);
  ok(itPerson?.company === "Houzs IT" && itPerson?.department === "IT", `IT users are in the directory as Houzs IT / IT (${JSON.stringify(itPerson)})`);
  x = await call(HC, lim, "GET", "/bootstrap");
  ok(x.j.people.some((p) => p.key === itPerson?.key), "an ERP sees the IT user and can invite them");
  x = await it("POST", "/rooms", { name: "IT room", seats: 4 });
  ok(x.status === 403, "IT user without Manage meeting rooms cannot add a room");
  x = await it("PUT", "/directory", { people: [] });
  ok(x.status === 404, "the staff-list route is not open to a browser");
  const day3 = new Date(Date.parse(day) + 2 * 86400e3).toISOString().slice(0, 10);
  const T3 = (h, m = 0) => `${day3}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`;
  x = await call(HC, lim, "POST", "/meetings", { title: "With IT", start: T3(10), end: T3(11), roomId: boardroom, attendees: [itPerson.key] });
  ok(x.status === 201, `ERP books with the IT user invited (${x.status})`);
  x = await it("GET", "/mine");
  ok(x.status === 200 && x.j.meetings.some((m) => m.title === "With IT") && x.j.notifications.some((n) => !n.read), "the IT user sees the invite and an unread notice");
  x = await it("GET", "/unread");
  ok(x.status === 200 && x.j.unread >= 1, `unread count for the IT sidebar (${x.j?.unread})`);
  x = await it("POST", "/meetings", { title: "IT clash", start: T3(10), end: T3(11), attendees: [] });
  ok(x.status === 409 && x.j.conflict.people.some((p) => p.key === itPerson.key), `IT user busy is blocked from IT Support too (${x.status})`);
  x = await it("POST", "/meetings", { title: "IT stand-up", start: T3(14), end: T3(14, 30), roomId: room1, attendees: ["lim@example.com"] });
  ok(x.status === 201, `IT user books a room and invites an ERP person (${x.status} ${JSON.stringify(x.j)})`);
  x = await call(HC, lim, "GET", "/mine");
  ok(x.j.meetings.some((m) => m.title === "IT stand-up"), "the ERP person sees the IT Support booking");
  x = await it("POST", "/links", { name: "IT visits", rooms: [boardroom], length: 60, days: [0, 1, 2, 3, 4, 5, 6], from: 10, to: 17, hosts: [itPerson.key], until: null });
  ok(x.status === 201, `IT user makes a guest link (${x.status})`);
  const itCode = x.j.code;
  const pub = async (method, path, body) => {
    const res = await fetch(`${ROOT}/public/meetings${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await res.json(); } catch {}
    return { status: res.status, j };
  };
  x = await pub("GET", `/links/${itCode}/slots?day=${day3}`);
  ok(x.status === 200 && x.j.slots.length > 0 && !x.j.slots.some((s) => s.start === new Date(T3(10)).toISOString()), `IT guest slots skip the host's busy time (${x.j?.slots?.length})`);
  x = await pub("GET", "/bootstrap");
  ok(x.status === 404, "the public route reaches only links and bookings");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
