// ---------------------------------------------------------------------------
// show_me (round 5, owner 2026-11-27): a picture of the real hub screen and the
// box around the button to press.
//
// What the tool returns (same as Hookka / Houzs after their fix):
//   * the PLAIN WebP screenshot as the image item (never SVG: Claude does not
//     accept SVG image content);
//   * the red-box coordinates in the text, plus the live-page ?highlight= link;
//   * a 15-minute link to an annotated page: the WebP with a red box and a caption
//     drawn by HTML / CSS (no SVG anywhere).
//
// Screenshots: frontend/public/help-shots/*.webp + boxes in mcp-help-shots-data.ts,
// captured by scripts/capture-help-shots.mjs against the local dev server with every
// API call answered by made-up demo data (no live data, no sign-in).
// RBAC: a page or button this person may not use gets no picture, only the note.
// ---------------------------------------------------------------------------
import { HELP_SHOTS, HELP_SHOTS_CAPTURED_AT, type Box, type Shot } from "./mcp-help-shots-data.ts";
import { HOWTO_GUIDES, screenForPath, whereIs } from "./mcp-howto.ts";
import { SCREENS } from "./mcp-howto-screens.ts";
import { canOpenPage, gatePasses, hubLink, NO_PERMISSION_NOTE, type HowtoUser } from "./mcp-howto-types.ts";

export { HELP_SHOTS_CAPTURED_AT };
export const TEST_DATA_NOTE = "This screenshot uses made-up test data, so names and numbers differ from yours, but the layout and the buttons are the same.";

/** A resolved picture: the page key in HELP_SHOTS, the label and its box. */
export type ShotHit = { page: string; label: string; shot: Shot; box: Box };

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The box of a label on a page's screenshot, or null. */
export function boxOn(page: string, label: string): ShotHit | null {
  const shot = Object.prototype.hasOwnProperty.call(HELP_SHOTS, page) ? HELP_SHOTS[page] : null;
  if (!shot) return null;
  const key = Object.keys(shot.boxes).find((k) => norm(k) === norm(label));
  return key ? { page, label: key, shot, box: shot.boxes[key] } : null;
}

/** Every page key a label may be on: the exact page first, then the path, then shots with a query on that path. */
function candidatePages(page: string): string[] {
  const path = page.split("?")[0];
  const withQuery = Object.keys(HELP_SHOTS).filter((k) => k.startsWith(`${path}?`) && k !== page);
  return [...new Set([page, path, ...withQuery])];
}

/** Find the picture for show_me's arguments: a guide step, a page (+ label), or a label alone. */
export function resolveShot(args: { path?: string; guide_id?: string; step?: number; label?: string }): ShotHit | { error: string } {
  const label = (args.label ?? "").trim();
  if (args.guide_id) {
    const g = HOWTO_GUIDES.find((x) => x.id === args.guide_id);
    if (!g) return { error: `No guide "${args.guide_id}". Use how_to to find the guide id.` };
    const steps = g.steps.filter((s) => s.page && s.highlight);
    const want = args.step && args.step > 0 ? g.steps[args.step - 1] : steps[0];
    if (!want?.page || !(label || want.highlight)) return { error: `That step of "${g.id}" has no button to show. Use its link instead.` };
    for (const p of candidatePages(want.page)) {
      const hit = boxOn(p, label || want.highlight!);
      if (hit) return hit;
    }
    return { error: `"${label || want.highlight}" is not on the captured screenshot of ${want.page} (it may be below the fold or need a record open). Use the step's link instead: it outlines the button on the real page.` };
  }
  if (args.path) {
    const raw = args.path.replace(/^https?:\/\/[^/]+/i, "");
    const screen = screenForPath(raw);
    const pages = [...new Set([raw, ...(screen ? candidatePages(screen.path) : []), ...candidatePages(raw)])];
    for (const p of pages) {
      if (!Object.prototype.hasOwnProperty.call(HELP_SHOTS, p)) continue;
      const hit = label ? boxOn(p, label) : ((k) => (k ? boxOn(p, k) : null))(Object.keys(HELP_SHOTS[p].boxes)[0]);
      if (hit) return hit;
    }
    return { error: `No screenshot of ${label ? `"${label}" on ` : ""}${raw.split("?")[0]} yet. Use the page link instead.` };
  }
  if (!label) return { error: "Give a guide_id (+ step), a path (+ label) or a label." };
  for (const w of whereIs(label)) {
    for (const p of candidatePages(w.screen.path)) {
      const hit = boxOn(p, w.action?.label ?? label);
      if (hit) return hit;
    }
  }
  for (const p of Object.keys(HELP_SHOTS)) {
    const hit = boxOn(p, label);
    if (hit) return hit;
  }
  return { error: `"${label}" is not on any captured screenshot. Use where_is for the page and its link.` };
}

/** May this person use what the picture points at: open the page, and hold any extra permission the button needs. */
export function mayUse(hit: ShotHit, u: HowtoUser): boolean {
  if (!canOpenPage(hit.page, u)) return false;
  const screen = SCREENS.find((s) => s.path === screenForPath(hit.page)?.path);
  const action = screen?.actions.find((a) => norm(a.label) === norm(hit.label));
  return !action?.need || gatePasses(action.need, u);
}

/** The red box in screenshot pixels, as written into the tool's text. */
export const redBoxOf = (hit: ShotHit) => ({ x: hit.box[0], y: hit.box[1], width: hit.box[2], height: hit.box[3], screenshotWidth: hit.shot.w, screenshotHeight: hit.shot.h });

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The annotated page behind the 15-minute link: the WebP as an <img> and a red box /
 * caption drawn with CSS, positioned in percent so it scales with the picture. No SVG,
 * no script; served with a CSP that allows only inline styles and data: images.
 */
export function annotatedHtml(hit: ShotHit, webpBase64: string, caption: string): string {
  const [x, y, w, h] = hit.box;
  const pad = 6;
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
  const left = pct(Math.max(0, x - pad), hit.shot.w);
  const top = pct(Math.max(0, y - pad), hit.shot.h);
  const width = pct(Math.min(hit.shot.w, w + pad * 2), hit.shot.w);
  const height = pct(Math.min(hit.shot.h, h + pad * 2), hit.shot.h);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(caption)}</title>
<style>body{margin:0;background:#111;color:#fff;font:16px system-ui,Segoe UI,sans-serif;display:flex;flex-direction:column;align-items:center}
.wrap{position:relative;max-width:100%;width:${hit.shot.w}px}.wrap img{display:block;width:100%;height:auto}
.box{position:absolute;left:${left};top:${top};width:${width};height:${height};border:4px solid #e11d48;border-radius:8px;box-sizing:border-box;box-shadow:0 0 0 9999px rgba(0,0,0,.25)}
.cap{width:${hit.shot.w}px;max-width:100%;box-sizing:border-box;padding:12px 16px;background:#1f2937}.note{opacity:.75;font-size:13px;margin-top:4px}</style></head>
<body><div class="wrap"><img alt="${esc(caption)}" src="data:image/webp;base64,${webpBase64}"><div class="box"></div></div>
<div class="cap">${esc(caption)}<div class="note">${esc(TEST_DATA_NOTE)}</div></div></body></html>`;
}

/** The CSP the annotated page is served with: nothing but inline styles and data: images. */
export const ANNOTATED_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The page to link to: the screenshot's demo ticket (?selected=) means nothing on the real hub. */
export function livePage(page: string): string {
  const [path, query = ""] = page.split("?");
  const q = new URLSearchParams(query);
  q.delete("selected");
  const rest = q.toString();
  return rest ? `${path}?${rest}` : path;
}

/** The text part of a show_me answer. */
export function showMeText(hit: ShotHit, origin: string, annotatedLink: string | null) {
  return {
    caption: `Press "${hit.label}" (inside the red box)`,
    press: hit.label,
    page: hit.page,
    redBox: redBoxOf(hit),
    redBoxNote: `The button is inside the red box at x ${hit.box[0]}, y ${hit.box[1]} (${hit.box[2]} × ${hit.box[3]} px) on the ${hit.shot.w} × ${hit.shot.h} screenshot. The annotated picture (box and caption drawn on) is at annotatedImage.`,
    ...(annotatedLink ? { annotatedImage: annotatedLink, expires: "15 minutes" } : {}),
    openThePage: hubLink(origin, livePage(hit.page), hit.label) ?? hit.page,
    note: TEST_DATA_NOTE,
    capturedAt: HELP_SHOTS_CAPTURED_AT,
  };
}

/** The MCP content of a show_me answer: the JSON text first, then the plain WebP image (never SVG). */
export function showMeContent(text: ReturnType<typeof showMeText>, webpBase64: string): [{ type: "text"; text: string }, { type: "image"; data: string; mimeType: "image/webp" }] {
  return [
    { type: "text", text: JSON.stringify(text) },
    { type: "image", data: webpBase64, mimeType: "image/webp" },
  ];
}

/** The no-permission answer: no picture, the same note as how_to. */
export const noPermissionText = (hit: ShotHit) => ({ page: hit.page, press: hit.label, canUse: false, note: NO_PERMISSION_NOTE });

/** show_me's tool definition. */
export const SHOW_ME_TOOL = {
  name: "show_me",
  title: "Show me where to click (screenshot)",
  description:
    "A screenshot of the hub page (plain WebP) with the red-box coordinates of the button to press, a 15-minute link to the annotated picture (red box and caption drawn on) and the live-page link that outlines the button. Pass guide_id (+ step) from how_to, or path (+ label) from where_is / explain_screen, or just label. The screenshot uses made-up test data; the layout is the same.",
  inputSchema: {
    type: "object",
    properties: {
      guide_id: { type: "string", description: "A how_to guide id" },
      step: { type: "number", description: "Step number in that guide (default: the first step with a button)" },
      path: { type: "string", description: "Hub page path, e.g. /tickets or /billing?tab=register" },
      label: { type: "string", description: "The button / tab label, e.g. New ticket" },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
} as const;
