import type { Metadata } from "next";
import { Suspense } from "react";
import { getCategories } from "@hci/db";
import { RecruitingBoardView } from "@/components/recruiting-board";
import { ListSkeleton } from "@/components/recruiting-now";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Recruiting" };

export default async function RecruitingPage() {
  const categories = await getCategories(db());
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <RecruitingBoardView categories={categories} />
    </Suspense>
  );
}
