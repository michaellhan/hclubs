"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Client-side because a static page can't read its query string before it ships. */
export function SuggestRedirect() {
  const router = useRouter();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.delete("about");
    if (!q.has("club") && !q.has("topic")) q.set("about", "club");
    router.replace(`/feedback?${q}`);
  }, [router]);
  return (
    <p className="text-sm text-stone-500">
      Suggestions now live on the{" "}
      <Link href="/feedback?about=club" className="underline">
        feedback page
      </Link>
      .
    </p>
  );
}
