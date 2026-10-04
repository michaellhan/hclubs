import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareView } from "@/components/compare-view";
import { ListSkeleton } from "@/components/recruiting-now";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Compare clubs",
  description: "Compare Harvard student clubs side by side: how to join, deadlines, time commitment, size and dues.",
  path: "/compare/",
});

export default function ComparePage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <CompareView />
      </Suspense>
    </div>
  );
}
