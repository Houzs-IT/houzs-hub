// ---------------------------------------------------------------------------
// capture-help-shots.mjs — screenshots for the AI Connector's show_me tool
// (round 5, owner 2026-11-27: a picture of the real hub screen with the box of
// the button to press).
//
//   npm --prefix frontend run dev        # Vite only (another terminal); do NOT start the backend
//   node scripts/capture-help-shots.mjs  # this script (BASE_URL defaults to http://localhost:5180)
//
// SAFETY — never real data, never real credentials:
//   * The hub's local dev points at the LIVE database. So EVERY /api/* request is
//     answered HERE with made-up demo data; none reaches the Vite proxy or wrangler.
//   * Every request to a host other than the dev server is aborted, and every
//     WebSocket (the live ticket feed) is closed before it connects.
//   * Nothing is ever typed into a sign-in form: the mocked /api/v1/dev/me answers as
//     a made-up "Demo Admin" (demo@example.invalid) holding every permission, so the
//     screenshot shows every button. Names, codes and numbers are not real.
//
// Output (both committed):
//   frontend/public/help-shots/<page>.webp     1280×800 WebP, made by Chromium's own encoder
//   backend/src/services/mcp-help-shots-data.ts  page → file, size and the box of each label
// backend/test/mcp-show-me.test.mjs fails when a boxed label no longer exists in
// frontend/src or a guide / screen label has no box: re-run this script.
//
// Env: BASE_URL, CHROME_PATH (a Chromium binary; default: newest ms-playwright chromium),
// PLAYWRIGHT_CORE (folder of playwright-core when it is not installed in this repo).
// ---------------------------------------------------------------------------
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:5180").replace(/\/$/, "");
const VIEWPORT = { width: 1280, height: 800 };
const OUT_DIR = join(ROOT, "frontend", "public", "help-shots");
const DATA_FILE = join(ROOT, "backend", "src", "services", "mcp-help-shots-data.ts");

async function loadPlaywright() {
  try {
    return await import("playwright-core");
  } catch {
    const p = process.env.PLAYWRIGHT_CORE;
    if (!p) throw new Error("playwright-core not found: set PLAYWRIGHT_CORE to its folder (npm i playwright-core in a scratch folder).");
    return await import(pathToFileURL(join(p, "index.mjs")).href);
  }
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), ".cache"), "ms-playwright");
  if (!existsSync(base)) return undefined;
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs)
    for (const rel of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
      const p = join(base, d, rel);
      if (existsSync(p)) return p;
    }
  return undefined;
}

const { HOWTO_GUIDES } = await import(pathToFileURL(join(ROOT, "backend/src/services/mcp-howto.ts")).href);
const { SCREENS } = await import(pathToFileURL(join(ROOT, "backend/src/services/mcp-howto-screens.ts")).href);
const { DEMO_TICKET, mockApi } = await import(pathToFileURL(join(ROOT, "scripts/help-shots-demo.mjs")).href);

// Pages to photograph (no :id pages; the ticket panel is opened with ?selected=) and the labels to box.
const pages = new Map();
const add = (page, label) => {
  if (page.includes(":")) return;
  if (!pages.has(page)) pages.set(page, new Set());
  if (label) pages.get(page).add(label);
};
const TICKET_PANEL = `/tickets?selected=${DEMO_TICKET}`;
for (const s of SCREENS) {
  if (s.path.includes(":")) continue;
  add(s.path, s.title); // the page heading, so a page without buttons still gets a picture
  for (const a of s.actions) add(s.path, a.label);
  for (const t of s.tabs) add(s.path, t);
}
// Ticket buttons live in the panel of an open ticket.
for (const a of SCREENS.find((s) => s.path === "/tickets/:code").actions) add(TICKET_PANEL, a.label);
for (const l of ["Pick up", "Reply", "Reply to reporter", "Add internal note", "Open full page", "Delete", "Assignee", "Module", "All", "Comments", "History"]) add(TICKET_PANEL, l);
for (const g of HOWTO_GUIDES) for (const st of g.steps) if (st.page && st.highlight) add(st.page, st.highlight);
for (const tab of ["overview", "register", "cards", "statements", "invoices", "accounts"]) add(`/billing?tab=${tab}`, null);
add("/meetings?tab=rooms", "Rooms");
add("/meetings?tab=links", "Guest links");
for (const s of SCREENS.filter((x) => x.path === "/billing")) for (const a of s.actions) for (const tab of ["overview", "register", "cards", "statements", "invoices", "accounts"]) add(`/billing?tab=${tab}`, a.label);

const esbuild = await import(pathToFileURL(join(ROOT, "frontend/node_modules/esbuild/lib/main.js")).href);
const matcher = esbuild.buildSync({ entryPoints: [join(ROOT, "frontend/src/lib/highlight-match.ts")], bundle: true, format: "iife", globalName: "HUBHL", write: false, platform: "browser" }).outputFiles[0].text;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "en-MY", timezoneId: "Asia/Kuala_Lumpur", colorScheme: "light" });
// A fixed clock (Thursday 26 Nov 2026, 11:00 Malaysia time) so the demo dates line up and re-captures are stable.
await ctx.clock.setFixedTime(new Date("2026-11-26T03:00:00Z"));
const baseHost = new URL(BASE_URL).host;
const leaks = [];
// The live ticket feed (/api/v1/dev/live) would go through the Vite proxy: close it. Vite's own HMR socket stays.
await ctx.routeWebSocket(/\/api\//, (ws) => ws.close());
await ctx.route("**/*", async (route) => {
  const req = route.request();
  let u;
  try {
    u = new URL(req.url());
  } catch {
    return route.abort();
  }
  if (u.host !== baseHost) return route.abort(); // nothing leaves this machine
  if (u.pathname.startsWith("/api/")) {
    const body = mockApi(req.method(), u);
    if (body === undefined) leaks.push(`${req.method()} ${u.pathname}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body ?? {}) });
  }
  return route.continue();
});

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
const slug = (p) => p.replace(/^\//, "").replace(/[/:?=&]+/g, "-").replace(/-+$/, "") || "home";
const shots = {};
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
let n = 0;
for (const [path, labelSet] of pages) {
  n++;
  errors.length = 0;
  try {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForFunction(() => !document.body.innerText.includes("Loading"), null, { timeout: 8_000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(600);
    const at = new URL(page.url());
    if (at.pathname !== path.split("?")[0]) {
      console.log(`skip ${path}: redirected to ${at.pathname}`);
      continue;
    }
    await page.addScriptTag({ content: matcher });
    const labels = [...labelSet];
    const boxes = await page.evaluate((list) => {
      const out = {};
      for (const label of list) {
        // The page's own content first, so a tab beats the sidebar link with the same name.
        const main = document.querySelector("main");
        const dialog = document.querySelector("dialog[open]");
        const el = (dialog && globalThis.HUBHL.findHighlightTarget(dialog, label)) || (main && globalThis.HUBHL.findHighlightTarget(main, label)) || globalThis.HUBHL.findHighlightTarget(document, label);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
        const x = Math.max(0, Math.round(r.left));
        const y = Math.max(0, Math.round(r.top));
        out[label] = [x, y, Math.round(Math.min(r.right, innerWidth) - x), Math.round(Math.min(r.bottom, innerHeight) - y)];
      }
      return out;
    }, labels);
    if (!Object.keys(boxes).length) {
      console.log(`skip ${path}: no labelled element on screen${errors.length ? ` (${errors[0]})` : ""}`);
      continue;
    }
    const png = await page.screenshot({ type: "png" });
    // Chromium's own WebP encoder: no extra image library needed.
    const webpB64 = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL("image/webp", 0.6).split(",")[1];
    }, png.toString("base64"));
    const file = `${slug(path)}.webp`;
    writeFileSync(join(OUT_DIR, file), Buffer.from(webpB64, "base64"));
    shots[path] = { file, w: VIEWPORT.width, h: VIEWPORT.height, boxes };
    const missing = labels.filter((l) => !boxes[l]);
    console.log(`${n}/${pages.size} ${path}: ${Object.keys(boxes).length} boxes${missing.length ? `; not on screen: ${missing.join(", ")}` : ""}${errors.length ? `; page error: ${errors[0]}` : ""}`);
  } catch (e) {
    console.log(`skip ${path}: ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
await browser.close();
if (leaks.length) console.log(`unmocked API calls (answered {}): ${[...new Set(leaks)].join(", ")}`);

writeFileSync(
  DATA_FILE,
  `// GENERATED by scripts/capture-help-shots.mjs — do not edit. Re-capture: npm --prefix frontend run dev, then node scripts/capture-help-shots.mjs.
// Screenshots use made-up demo data (every API call answered by the script, no sign-in); names and numbers differ, the layout is the same.
export type Box = [number, number, number, number];
export type Shot = { file: string; w: number; h: number; boxes: Record<string, Box> };
export const HELP_SHOTS_CAPTURED_AT = ${JSON.stringify(new Date().toISOString().slice(0, 10))};
export const HELP_SHOTS: Record<string, Shot> = ${JSON.stringify(shots, null, 1)};
`,
);
console.log(`wrote ${Object.keys(shots).length} screenshots`);
