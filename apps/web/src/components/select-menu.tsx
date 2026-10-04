"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Indented under the option before it (subcategories). */
  nested?: boolean;
}

/**
 * The site's dropdown: a pill button opening a styled listbox, in place of the browser's
 * native <select> menu. Keyboard: ↑/↓/Home/End move, Enter/Space pick, Esc closes,
 * typing jumps to the first option starting with that letter.
 */
export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  label,
  buttonLabel,
  className,
  align = "left",
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name of the control ("Sort", "Category"). */
  label: string;
  /** Text on the button; defaults to the selected option's label. */
  buttonLabel?: string;
  className: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(selectedIndex);
  // Flips to the button's right edge when the menu would run off a narrow screen.
  const [flip, setFlip] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const optionId = (i: number) => `${id}-o${i}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    const box = list.current?.getBoundingClientRect();
    if (box && align === "left" && box.right > window.innerWidth - 8) setFlip(true);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, align]);

  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from the stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const show = () => {
    setActive(selectedIndex);
    setFlip(false);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const pick = (i: number) => {
    const o = options[i];
    close();
    if (o && o.value !== value) onChange(o.value);
  };

  const selected = options[selectedIndex];
  return (
    <div ref={root} className="relative inline-block max-w-full">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? ""}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
        className={`inline-flex max-w-full items-center gap-1.5 ${className}`}
      >
        <span className="truncate">{buttonLabel ?? selected?.label}</span>
        <span aria-hidden className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open ? (
        <ul
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={optionId(active)}
          onKeyDown={(e) => {
            const last = options.length - 1;
            if (e.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
            else if (e.key === "Home") setActive(0);
            else if (e.key === "End") setActive(last);
            else if (e.key === "Enter" || e.key === " ") pick(active);
            else if (e.key === "Escape" || e.key === "Tab") {
              if (e.key === "Escape") e.stopPropagation();
              close();
              if (e.key === "Tab") return;
            } else if (e.key.length === 1 && /\S/.test(e.key)) {
              const k = e.key.toLowerCase();
              const from = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
              const i = from >= 0 ? from : options.findIndex((o) => o.label.toLowerCase().startsWith(k));
              if (i >= 0) setActive(i);
            } else return;
            e.preventDefault();
          }}
          className={`absolute top-full z-50 mt-1 max-h-80 w-max max-w-[min(20rem,calc(100vw-2rem))] min-w-full overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 text-sm shadow-lg outline-none dark:border-stone-700 dark:bg-stone-900 ${
            align === "right" || flip ? "right-0" : "left-0"
          }`}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                onPointerMove={() => setActive(i)}
                onClick={() => pick(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg pr-3 sm:min-h-8 ${o.nested ? "pl-6" : "pl-2.5"} ${
                  i === active ? "bg-stone-100 dark:bg-stone-800" : ""
                } ${isSelected ? "font-medium text-accent" : "text-stone-700 dark:text-stone-300"}`}
              >
                <span className="flex-1">{o.label}</span>
                <span aria-hidden className={`text-xs ${isSelected ? "" : "invisible"}`}>
                  ✓
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
