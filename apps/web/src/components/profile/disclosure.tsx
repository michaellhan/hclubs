import type { ReactNode } from "react";
import { Chevron } from "@/components/ui";

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
        <Chevron className="text-stone-400 group-open:rotate-180" />
      </summary>
      {/* Lists inside drop their outer rules: the row dividers above and below already frame them. */}
      <div className="pt-1 pb-5 [&_.hc-list]:border-y-0">{children}</div>
    </details>
  );
}

/** Wraps disclosure rows so the first one gets a top rule. */
export function DisclosureList({ children }: { children: ReactNode }) {
  return <div className="border-t border-stone-100 dark:border-stone-800">{children}</div>;
}
