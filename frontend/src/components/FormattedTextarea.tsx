import { Bold, Italic, Link2, List } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from "react";
import { continueBullets, insertLink, toggleBullets, toggleWrap, type TextEdit, type TextSelection } from "../lib/textFormat";

export interface FormattedTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

type FormatAction = (selection: TextSelection) => TextEdit;

const SHORTCUTS: Record<string, FormatAction> = {
  b: (selection) => toggleWrap(selection, "**"),
  i: (selection) => toggleWrap(selection, "_"),
  k: insertLink,
};

function readSelection(textarea: HTMLTextAreaElement): TextSelection {
  return { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
}

function editForKey(e: KeyboardEvent<HTMLTextAreaElement>): TextEdit | null {
  const selection = readSelection(e.currentTarget);
  const hasCommandKey = e.ctrlKey || e.metaKey;
  if (e.altKey || e.shiftKey) return null;
  if (hasCommandKey) return SHORTCUTS[e.key.toLowerCase()]?.(selection) ?? null;
  return e.key === "Enter" ? continueBullets(selection) : null;
}

function runEditCommand({ insert, start, end }: TextEdit): boolean {
  if (insert) return document.execCommand("insertText", false, insert);
  return start === end || document.execCommand("delete");
}

function applyEdit(textarea: HTMLTextAreaElement, edit: TextEdit, onChange: (value: string) => void): void {
  textarea.focus();
  textarea.setSelectionRange(edit.start, edit.end);
  // execCommand keeps the edit on the browser's undo stack, so Ctrl+Z still works.
  const isApplied = runEditCommand(edit);
  if (!isApplied) {
    textarea.setRangeText(edit.insert, edit.start, edit.end);
    onChange(textarea.value);
  }
  textarea.setSelectionRange(edit.selectStart, edit.selectEnd);
}

function ToolbarButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="tap flex h-8 w-8 items-center justify-center rounded text-ink-subtle hover:bg-hover hover:text-ink"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

export default function FormattedTextarea({ value, onChange, onKeyDown, ...textareaProps }: FormattedTextareaProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function format(action: FormatAction): void {
    const textarea = textareaRef.current;
    if (textarea) applyEdit(textarea, action(readSelection(textarea)), onChange);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const edit = editForKey(e);
    if (!edit) return;
    e.preventDefault();
    applyEdit(e.currentTarget, edit, onChange);
  }

  return (
    <>
      <div role="toolbar" aria-label="Formatting" className="flex gap-0.5 border-b border-line px-1.5 py-1">
        <ToolbarButton label="Bold (Ctrl+B)" onPress={() => format((selection) => toggleWrap(selection, "**"))}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Italic (Ctrl+I)" onPress={() => format((selection) => toggleWrap(selection, "_"))}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Bullet points" onPress={() => format(toggleBullets)}>
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Link (Ctrl+K)" onPress={() => format(insertLink)}>
          <Link2 className="h-4 w-4" />
        </ToolbarButton>
      </div>
      <textarea ref={textareaRef} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={handleKeyDown} {...textareaProps} />
    </>
  );
}
