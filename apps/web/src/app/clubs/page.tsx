import type { Metadata } from "next";
import { Suspense } from "react";
import { getCategories } from "@hci/db";
import { Directory } from "@/components/directory";
import { db } from "@/lib/db";
import Loading from "./loading";

export const metadata: Metadata = { title: "Directory" };

export default async function DirectoryPage() {
  // Categories (and their counts) are fixed at build time; search and filtering run in the browser.
  const categories = await getCategories(db());
  return (
    <Suspense fallback={<Loading />}>
      <Directory categories={categories} />
    </Suspense>
  );
}
