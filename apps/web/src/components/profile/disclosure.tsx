import type { ReactNode } from "react";

/**
 * One collapsed row of a profile's secondary information ("Details", "In the news", "Sources"…).
 * Rows stack into a quiet list under the essentials; each opens in place. Plain markup, so
 * both server and client components can use it.
 */
export function Disclosure({
  title,
  meta,
  id,
  open = false,
  children,
}: {
  title: ReactNode;
  /** Muted text after the title, e.g. a count. */
  meta?: ReactNode;
  id?: string;
  /** Starts open (e.g. the next step after a closed deadline). */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} open={open} className="group scroll-mt-20 border-b border-stone-100 dark:border-stone-800">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-stone-800 hover:text-stone-950 dark:text-stone-200 dark:hover:text-white [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {meta ? <span className="ml-2 font-normal text-stone-500 dark:text-stone-400">{meta}</span> : null}
        </span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="size-4 shrink-0 text-stone-400 transition-transform group-open:rotate-180"
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="pt-1 pb-5">{children}</div>
    </details>
  );
}

/** Wraps disclosure rows so the first one gets a top rule. */
export function DisclosureList({ children }: { children: ReactNode }) {
  return <div className="border-t border-stone-100 dark:border-stone-800">{children}</div>;
}
