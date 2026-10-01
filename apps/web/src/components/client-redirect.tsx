"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { withBase } from "@/lib/site";

/**
 * Redirect for a static page (retired or merged club slugs). Static hosts can't send a
 * 308, so the page carries a meta refresh plus a client-side replace and a visible link.
 */
export function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => router.replace(to), [router, to]);
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${withBase(to)}`} />
      <link rel="canonical" href={withBase(to)} />
      <p className="text-sm text-stone-500">
        This club moved to{" "}
        <Link href={to} className="underline">
          its new page
        </Link>
        .
      </p>
    </>
  );
}
