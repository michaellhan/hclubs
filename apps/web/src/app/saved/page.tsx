import type { Metadata } from "next";
import { Suspense } from "react";
import { SavedView } from "@/components/saved-view";
import { ListSkeleton } from "@/components/recruiting-now";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Saved clubs",
    description: "The clubs you saved, with deadlines and how to join. Kept in your browser only.",
    path: "/saved/",
  }),
  robots: { index: false },
};

export default function SavedPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <SavedView />
    </Suspense>
  );
}
