import { Chevron } from "./ui";

/**
 * Collapsed on phones so the list isn't pushed two screens down; always open from md up.
 * Pure CSS (the facets are rendered once per layout), so phones never see them flash open
 * before collapsing, and no-JS readers get the same behaviour.
 */
export function FacetDisclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <details className="group md:hidden">
        <summary className="hc-chip cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
          {label}
          <Chevron className="group-open:rotate-180" />
        </summary>
        <div className="mt-3">{children}</div>
      </details>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
