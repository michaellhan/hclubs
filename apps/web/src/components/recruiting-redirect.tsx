"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Old board URL → directory URL, PURE: `category` and `join` carry over; class years have
 * no directory filter, so `class` is dropped.
 */
export function recruitingRedirectHref(search: string): string {
  const sp = new URLSearchParams(search);
  const out = new URLSearchParams({ recruiting: "1" });
  const category = sp.get("category");
  const join = sp.get("join");
  if (category && /^[a-z0-9-]+$/.test(category)) out.set("category", category);
  if (join && /^[a-z_]+$/.test(join)) out.set("join", join);
  return `/clubs?${out}`;
}

/** Client-side because a static page can't read its query string before it ships. */
export function RecruitingRedirect() {
  const router = useRouter();
  useEffect(() => router.replace(recruitingRedirectHref(window.location.search)), [router]);
  return (
    <p className="text-sm text-stone-500">
      Recruiting now lives in the{" "}
      <Link href="/clubs?recruiting=1" className="underline">
        directory
      </Link>
      .
    </p>
  );
}
