/**
 * Collapsed on phones so the list isn't pushed two screens down; always open from md up.
 * Pure CSS (the facets are rendered once per layout), so phones never see them flash open
 * before collapsing, and no-JS readers get the same behaviour.
 */
export function FacetDisclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <details className="group md:hidden">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-stone-200 px-4 text-sm font-medium hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600">
          {label}
          <span aria-hidden className="text-stone-500 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="mt-3">{children}</div>
      </details>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
