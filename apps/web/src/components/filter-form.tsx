"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { withBase } from "@/lib/site";
import { track } from "@/lib/track";

/**
 * Plain GET form (works without JS). With JS, any change re-navigates immediately so
 * filters feel instant while remaining URL-driven and shareable.
 */
export function FilterForm({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      method="get"
      action={withBase("/clubs")}
      className={`${className ?? ""} ${pending ? "opacity-70" : ""} transition-opacity`}
      onChange={(e) => {
        const name = (e.target as unknown as HTMLInputElement).name;
        if (name) track(`filter:${name}`);
        const form = e.currentTarget;
        const data = new FormData(form);
        const params = new URLSearchParams();
        for (const [k, v] of data.entries()) if (typeof v === "string" && v !== "") params.append(k, v);
        startTransition(() => router.replace(`/clubs${params.size ? `?${params}` : ""}`, { scroll: false }));
      }}
    >
      {children}
      <noscript>
        <button type="submit" className="hc-btn-primary mt-3">
          Apply filters
        </button>
      </noscript>
    </form>
  );
}
