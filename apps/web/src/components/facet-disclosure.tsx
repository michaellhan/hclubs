"use client";

import { useEffect, useRef } from "react";

/**
 * Open on desktop and without JavaScript; collapsed on phones so the list isn't pushed two
 * screens down. The collapse happens after mount, so it never hides content from crawlers.
 */
export function FacetDisclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches && ref.current) ref.current.open = false;
  }, []);
  return (
    <details ref={ref} open className="group md:[&>summary]:hidden">
      <summary className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-stone-200 px-4 text-sm font-medium hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600">
        {label}
        <span aria-hidden className="text-stone-500 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
