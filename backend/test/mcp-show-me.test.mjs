// AI Connector round 5 show_me (src/services/mcp-show-me.ts + mcp-help-shots-data.ts):
// the screenshots exist and are WebP, every boxed label still exists in frontend/src
// (else: re-capture with scripts/capture-help-shots.mjs), boxes lie inside the picture,
// the answer is a plain WebP (never SVG) + red-box coordinates + a 15-minute link, and
// a page or button the person may not use gets no picture. Run: npm --prefix backend test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP_SHOTS } from "../src/services/mcp-help-shots-data.ts";
import { annotatedHtml, ANNOTATED_CSP, livePage, mayUse, noPermissionText, resolveShot, SHOW_ME_TOOL, showMeContent, showMeText, TEST_DATA_NOTE } from "../src/services/mcp-show-me.ts";
import { HOWTO_GUIDES } from "../src/services/mcp-howto.ts";
import { SCREENS } from "../src/services/mcp-howto-screens.ts";
import { TOOL_NEEDS } from "../src/services/mcp-visibility.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const SHOTS_DIR = join(here, "../../frontend/public/help-shots");
const FRONT = join(here, "../../frontend/src");
const O = "https://support.example";
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e) && !/\.test\./.test(e)) out.push(p);
  }
  return out;
};
const front = walk(FRONT).map((f) => readFileSync(f, "utf8")).join("\n");
const frontFlat = front.replace(/\s+/g, " ");
const inFrontend = (l) => front.includes(l) || frontFlat.includes(l);
const pages = Object.keys(HELP_SHOTS);

test("screenshots: every file exists, is WebP, small, and nothing else is in the folder", () => {
  assert.ok(pages.length >= 15, String(pages.length));
  for (const p of pages) {
    const f = join(SHOTS_DIR, HELP_SHOTS[p].file);
    assert.ok(existsSync(f), `missing ${f}`);
    const b = readFileSync(f);
    assert.equal(b.subarray(0, 4).toString("ascii"), "RIFF", f);
    assert.equal(b.subarray(8, 12).toString("ascii"), "WEBP", f);
    assert.ok(b.length < 200_000, `${f} is ${b.length} bytes`);
  }
  const files = new Set(pages.map((p) => HELP_SHOTS[p].file));
  assert.deepEqual(readdirSync(SHOTS_DIR).filter((f) => !files.has(f)), [], "stale screenshot files");
});

test("boxes stay fresh: every boxed label exists in frontend/src and every box lies inside its picture", () => {
  const bad = [];
  for (const p of pages) {
    const s = HELP_SHOTS[p];
    for (const [label, [x, y, w, h]] of Object.entries(s.boxes)) {
      if (!inFrontend(label)) bad.push(`${p}: "${label}" no longer in frontend/src — re-capture`);
      if (!(x >= 0 && y >= 0 && w > 1 && h > 1 && x + w <= s.w && y + h <= s.h)) bad.push(`${p}: "${label}" box out of the picture`);
    }
  }
  assert.deepEqual(bad, []);
});

test("coverage: every portal screen has a picture; most guide steps with a button resolve to a box", () => {
  for (const s of SCREENS.filter((x) => !x.path.includes(":"))) assert.ok(pages.some((p) => p.split("?")[0] === s.path), `no screenshot of ${s.path}`);
  let ok = 0;
  let all = 0;
  const missing = [];
  for (const g of HOWTO_GUIDES)
    g.steps.forEach((st, i) => {
      if (!st.page || !st.highlight) return;
      all++;
      const hit = resolveShot({ guide_id: g.id, step: i + 1 });
      if ("error" in hit) missing.push(`${g.id}#${i + 1} ${st.highlight}`);
      else ok++;
    });
  // Some buttons sit below the fold or only appear for a person without access (e.g. Request access).
  assert.ok(ok / all >= 0.8, `only ${ok}/${all} guide buttons have a box; missing: ${missing.join("; ")}`);
});

test("resolveShot: by guide step, by path + label, by label; unknown gives an error", () => {
  const g = resolveShot({ guide_id: "report-it-problem", step: 1 });
  assert.equal(g.label, "New ticket");
  assert.equal(resolveShot({ path: `${O}/billing?tab=register`, label: "Add charge" }).label, "Add charge");
  assert.equal(resolveShot({ label: "Pick up" }).page, "/tickets?selected=DA-0042");
  assert.ok("error" in resolveShot({ guide_id: "no-such-guide" }));
  assert.ok("error" in resolveShot({ label: "zzzz no such button" }));
});

test("RBAC: no picture of a page or button the person may not use", () => {
  const pick = resolveShot({ label: "Pick up" });
  assert.equal(mayUse(pick, { perms: [] }), false);
  assert.equal(mayUse(pick, { perms: ["it"] }), true);
  const del = resolveShot({ path: "/tickets?selected=DA-0042", label: "Delete" });
  assert.equal(mayUse(del, { perms: ["it"] }), false, "Delete needs Delete tickets");
  assert.equal(mayUse(del, { perms: ["it", "delete_tickets"] }), true);
  const charge = resolveShot({ path: "/billing?tab=register", label: "Add charge" });
  assert.equal(mayUse(charge, { perms: ["billing_view"] }), false);
  assert.equal(mayUse(resolveShot({ label: "Book a room" }), { perms: [] }), true);
  assert.match(noPermissionText(pick).note, /don't have permission/);
});

test("answer: the plain WebP image (never SVG), red-box coordinates, the 15-minute link, the live-page link", () => {
  const hit = resolveShot({ label: "Pick up" });
  const t = showMeText(hit, O, `${O}/api/mcp/shot/abc`);
  const content = showMeContent(t, "UklGRg==");
  assert.equal(content[0].type, "text");
  assert.equal(content[1].type, "image");
  assert.equal(content[1].mimeType, "image/webp");
  assert.ok(!content.some((c) => c.type === "image" && /svg/i.test(c.mimeType)));
  const j = JSON.parse(content[0].text);
  assert.deepEqual(j.redBox, { x: hit.box[0], y: hit.box[1], width: hit.box[2], height: hit.box[3], screenshotWidth: 1280, screenshotHeight: 800 });
  assert.equal(j.expires, "15 minutes");
  assert.equal(j.openThePage, `${O}/tickets?highlight=Pick%20up`, "the demo ticket is not linked");
  assert.equal(j.note, TEST_DATA_NOTE);
  assert.equal(JSON.parse(showMeContent(showMeText(hit, O, null), "A")[0].text).expires, undefined);
  assert.equal(livePage("/billing?tab=register&selected=X"), "/billing?tab=register");
});

test("annotated page: no SVG, no script, escaped caption, box in percent; strict CSP", () => {
  const hit = resolveShot({ label: "Pick up" });
  const html = annotatedHtml(hit, "UklGRg==", 'Press "<b>x</b>"');
  assert.doesNotMatch(html, /<svg|<script|javascript:/i);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /left:\d+(\.\d+)?%;top:\d+(\.\d+)?%/);
  assert.match(html, /data:image\/webp;base64,UklGRg==/);
  assert.match(ANNOTATED_CSP, /default-src 'none'/);
  assert.doesNotMatch(ANNOTATED_CSP, /script-src/);
});

test("wiring: listed for everyone, read-only; the route sends showMeContent and serves the link with the CSP", () => {
  assert.equal(TOOL_NEEDS.show_me, null);
  assert.equal(SHOW_ME_TOOL.annotations.readOnlyHint, true);
  const mcp = readFileSync(join(here, "../src/routes/mcp.ts"), "utf8");
  const fn = mcp.slice(mcp.indexOf("async function showMeTool"), mcp.indexOf("/** The real I/O for services/mcp-write-actions.ts"));
  assert.match(fn, /showMeContent\(/);
  assert.match(fn, /mayUse\(hit, id\.user\)/);
  assert.doesNotMatch(fn, /svg/i);
  assert.match(mcp, /app\.get\("\/shot\/:token"[\s\S]*Content-Security-Policy": ANNOTATED_CSP/);
  assert.match(mcp, /if \(name === "show_me"\) return showMeTool/);
});
