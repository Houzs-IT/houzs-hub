export interface TextSelection {
  value: string;
  start: number;
  end: number;
}

export interface TextEdit {
  start: number;
  end: number;
  insert: string;
  selectStart: number;
  selectEnd: number;
}

const BULLET_PREFIX = /^(\s*)[-*•]\s+/;
const URL_ONLY = /^https?:\/\/\S+$/;
const LINK_PLACEHOLDER = "link text";
const URL_PLACEHOLDER = "https://";

function trimSelection({ value, start, end }: TextSelection): TextSelection {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/.test(value[trimmedStart])) trimmedStart++;
  while (trimmedEnd > trimmedStart && /\s/.test(value[trimmedEnd - 1])) trimmedEnd--;
  return { value, start: trimmedStart, end: trimmedEnd };
}

export function toggleWrap(selection: TextSelection, marker: string): TextEdit {
  const { value, start, end } = trimSelection(selection);
  const selected = value.slice(start, end);
  const isWrapped = value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker;
  const isWrappedInside = selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker);
  if (isWrappedInside) {
    const inner = selected.slice(marker.length, -marker.length);
    return { start, end, insert: inner, selectStart: start, selectEnd: start + inner.length };
  }
  if (isWrapped) {
    const innerStart = start - marker.length;
    return { start: innerStart, end: end + marker.length, insert: selected, selectStart: innerStart, selectEnd: innerStart + selected.length };
  }
  const innerStart = start + marker.length;
  return { start, end, insert: `${marker}${selected}${marker}`, selectStart: innerStart, selectEnd: innerStart + selected.length };
}

function lineRange({ value, start, end }: TextSelection): { lineStart: number; lineEnd: number } {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = value.indexOf("\n", end);
  return { lineStart, lineEnd: nextBreak === -1 ? value.length : nextBreak };
}

export function toggleBullets(selection: TextSelection): TextEdit {
  const { lineStart, lineEnd } = lineRange(selection);
  const lines = selection.value.slice(lineStart, lineEnd).split("\n");
  const filledLines = lines.filter((line) => line.trim() !== "");
  const isAllBullets = filledLines.length > 0 && filledLines.every((line) => BULLET_PREFIX.test(line));
  const nextLines = isAllBullets
    ? lines.map((line) => line.replace(BULLET_PREFIX, "$1"))
    : lines.map((line) => (line.trim() === "" && filledLines.length ? line : `- ${line}`));
  const insert = nextLines.join("\n");
  const isCaretOnly = selection.start === selection.end;
  return {
    start: lineStart,
    end: lineEnd,
    insert,
    selectStart: isCaretOnly ? lineStart + insert.length : lineStart,
    selectEnd: lineStart + insert.length,
  };
}

export function insertLink({ value, start, end }: TextSelection): TextEdit {
  const selected = value.slice(start, end).trim();
  if (URL_ONLY.test(selected)) {
    return { start, end, insert: `[${LINK_PLACEHOLDER}](${selected})`, selectStart: start + 1, selectEnd: start + 1 + LINK_PLACEHOLDER.length };
  }
  if (selected) {
    const urlStart = start + selected.length + 3;
    return { start, end, insert: `[${selected}](${URL_PLACEHOLDER})`, selectStart: urlStart, selectEnd: urlStart + URL_PLACEHOLDER.length };
  }
  return { start, end, insert: `[${LINK_PLACEHOLDER}](${URL_PLACEHOLDER})`, selectStart: start + 1, selectEnd: start + 1 + LINK_PLACEHOLDER.length };
}

export function continueBullets(selection: TextSelection): TextEdit | null {
  const { value, start, end } = selection;
  if (start !== end) return null;
  const { lineStart } = lineRange(selection);
  const lineBeforeCaret = value.slice(lineStart, start);
  const bullet = BULLET_PREFIX.exec(lineBeforeCaret);
  if (!bullet) return null;
  const isEmptyItem = lineBeforeCaret.trim() === bullet[0].trim() && value.slice(start).split("\n")[0].trim() === "";
  if (isEmptyItem) return { start: lineStart, end: start, insert: "", selectStart: lineStart, selectEnd: lineStart };
  const insert = `\n${bullet[1]}- `;
  return { start, end, insert, selectStart: start + insert.length, selectEnd: start + insert.length };
}
