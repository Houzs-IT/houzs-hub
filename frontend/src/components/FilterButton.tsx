import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type Option = { value: string; label: string; icon?: ReactNode };

export function useOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open, onClose]);
  return ref;
}

export default function FilterButton({
  label,
  options,
  selected,
  onChange,
  isDefault = false,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  // A preset selection the user did not choose (Status: Active) looks like an untouched filter.
  isDefault?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false));
  const on = selected.length > 0 && !isDefault;

  function toggle(v: string) {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`btn h-9 px-3 ${
          on
            ? "border border-primary/40 bg-primary-soft text-primary-ink hover:bg-primary-soft-hover"
            : "border border-line bg-surface text-ink-subtle shadow-stone hover:border-line-strong hover:text-ink"
        }`}
      >
        {label}
        {on && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold leading-4 text-primary-on">{selected.length}</span>}
        <ChevronDown className="h-4 w-4" />
      </button>
      {/* Phones: the backdrop takes the dismissing tap, so it cannot also open whatever is underneath. */}
      {open && <div className="fixed inset-0 z-20 bg-black/30 sm:hidden" onClick={() => setOpen(false)} />}
      {open && (
        <div role="menu" aria-label={label} className="absolute left-0 top-10 z-30 max-h-[60vh] min-w-[220px] overflow-y-auto overscroll-contain rounded-[10px] border border-transparent bg-overlay py-1.5 shadow-overlay max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 max-sm:top-auto">
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <button
                key={o.value}
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => toggle(o.value)}
                className="tap flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-primary-soft"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border-2 ${
                    checked ? "border-primary bg-primary" : "border-line-strong"
                  }`}
                >
                  {checked && <Check className="h-3 w-3 text-primary-on" strokeWidth={3.5} />}
                </span>
                {o.icon}
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
          <div className={`mt-1 flex items-center border-t border-line px-3 pt-1.5 ${on ? "" : "sm:hidden"}`}>
            {on && (
              <button className="tap text-sm text-ink-subtle hover:text-primary" onClick={() => onChange([])}>
                Clear selection
              </button>
            )}
            <button className="tap ml-auto text-sm font-semibold text-primary sm:hidden" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
