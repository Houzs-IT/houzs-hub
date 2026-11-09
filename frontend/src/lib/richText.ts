// A small Markdown subset for replies and notes: **bold**, _italic_, "- " bullets,
// [text](url) and bare links. Stored as plain text, so reporter systems that read
// the body raw still get something readable.

export interface TextNode {
  kind: "text";
  text: string;
}

export interface BoldNode {
  kind: "bold";
  children: InlineNode[];
}

export interface ItalicNode {
  kind: "italic";
  children: InlineNode[];
}

export interface LinkNode {
  kind: "link";
  href: string;
  label: string;
}

export type InlineNode = TextNode | BoldNode | ItalicNode | LinkNode;

export interface ParagraphBlock {
  kind: "paragraph";
  children: InlineNode[];
}

export interface ListBlock {
  kind: "list";
  items: InlineNode[][];
}

export type RichBlock = ParagraphBlock | ListBlock;

const BULLET_LINE = /^\s*[-*•]\s+(.*)$/;
const SAFE_PROTOCOLS = ["http:", "https:", "mailto:"];
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;
const INLINE_PATTERN = new RegExp(
  [
    /\[(?<label>[^\]\n]+)\]\((?<href>[^)\s]+)\)/u.source,
    /(?<url>https?:\/\/[^\s<>()]+)/u.source,
    /\*\*(?<bold>\S(?:[\s\S]*?\S)?)\*\*/u.source,
    /(?<![\p{L}\p{N}_])_(?<italic>\S(?:[^_\n]*?\S)?)_(?![\p{L}\p{N}_])/u.source,
  ].join("|"),
  "gu",
);

export function toSafeHref(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return SAFE_PROTOCOLS.includes(protocol) ? url : null;
  } catch {
    return null;
  }
}

function parseBareUrl(match: string): InlineNode[] {
  const url = match.replace(TRAILING_PUNCTUATION, "");
  const trailing = match.slice(url.length);
  const href = toSafeHref(url);
  const link: InlineNode = href ? { kind: "link", href, label: url } : { kind: "text", text: url };
  return trailing ? [link, { kind: "text", text: trailing }] : [link];
}

function parseMatch(match: RegExpMatchArray): InlineNode[] {
  const { label, href, url, bold, italic } = match.groups ?? {};
  if (label !== undefined && href !== undefined) {
    const safeHref = toSafeHref(href);
    return [safeHref ? { kind: "link", href: safeHref, label } : { kind: "text", text: match[0] }];
  }
  if (url !== undefined) return parseBareUrl(url);
  if (bold !== undefined) return [{ kind: "bold", children: parseInline(bold) }];
  if (italic !== undefined) return [{ kind: "italic", children: parseInline(italic) }];
  return [{ kind: "text", text: match[0] }];
}

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let position = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > position) nodes.push({ kind: "text", text: text.slice(position, start) });
    nodes.push(...parseMatch(match));
    position = start + match[0].length;
  }
  if (position < text.length) nodes.push({ kind: "text", text: text.slice(position) });
  return nodes;
}

function trimBlankEdgeLines(lines: string[]): string[] {
  const firstFilled = lines.findIndex((line) => line.trim() !== "");
  if (firstFilled === -1) return [];
  const lastFilled = lines.length - 1 - [...lines].reverse().findIndex((line) => line.trim() !== "");
  return lines.slice(firstFilled, lastFilled + 1);
}

function toParagraph(lines: string[]): ParagraphBlock[] {
  const filledLines = trimBlankEdgeLines(lines);
  return filledLines.length ? [{ kind: "paragraph", children: parseInline(filledLines.join("\n")) }] : [];
}

export function parseRichText(body: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: InlineNode[][] = [];

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = BULLET_LINE.exec(line);
    if (bullet) {
      blocks.push(...toParagraph(paragraphLines));
      paragraphLines = [];
      listItems.push(parseInline(bullet[1]));
      continue;
    }
    if (listItems.length) blocks.push({ kind: "list", items: listItems });
    listItems = [];
    paragraphLines.push(line);
  }
  if (listItems.length) blocks.push({ kind: "list", items: listItems });
  blocks.push(...toParagraph(paragraphLines));
  return blocks;
}
