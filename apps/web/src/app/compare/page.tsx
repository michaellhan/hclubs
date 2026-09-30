import type { Metadata } from "next";
import { Suspense } from "react";
import { CompareView } from "@/components/compare-view";
import { ListSkeleton } from "@/components/recruiting-now";

export const metadata: Metadata = { title: "Compare clubs" };

export default function ComparePage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <CompareView />
    </Suspense>
  );
}
