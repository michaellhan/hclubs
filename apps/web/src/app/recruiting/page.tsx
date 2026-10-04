import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getCategories } from "@hci/db";
import { RecruitingBoardView } from "@/components/recruiting-board";
import { ListSkeleton } from "@/components/recruiting-now";
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Recruiting",
  description:
    "Harvard student clubs recruiting now: deadlines this week, open applications, comps, auditions and tryouts, clubs you can join anytime, and the next round if you missed one.",
  path: "/recruiting/",
});

export default async function RecruitingPage() {
  const categories = await getCategories(db());
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Server-rendered so the prerendered page has its heading before the board loads. */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recruiting</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
          Deadlines, open rounds and clubs you can join anytime. Confirm dates on the club&apos;s page.
        </p>
        <noscript>
          <p className="mt-2 text-sm">
            The board needs JavaScript to work out today&apos;s deadlines.{" "}
            <Link href="/clubs" className="hc-link">
              Browse all clubs
            </Link>
          </p>
        </noscript>
      </div>
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <RecruitingBoardView categories={categories} />
      </Suspense>
    </div>
  );
}
