"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Footer link to /feedback that remembers which page the visitor was on. */
export function FeedbackLink({ className }: { className: string }) {
  const path = usePathname();
  const from = path && path !== "/" && !path.startsWith("/feedback") ? `?from=${encodeURIComponent(path)}` : "";
  return (
    <Link href={`/feedback${from}`} className={className}>
      Feedback
    </Link>
  );
}
