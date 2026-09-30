import type { MetadataRoute } from "next";
import { getCategories, getClubOptions } from "@hci/db";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [clubs, categories] = await Promise.all([getClubOptions(db()), getCategories(db())]);
  return [
    ...["", "/clubs", "/recruiting", "/about", "/about/methodology", "/about/bot"].map((p) => ({ url: `${base}${p}` })),
    ...categories.filter((c) => c.clubCount > 0).map((c) => ({ url: `${base}/categories/${c.slug}` })),
    ...clubs.map((c) => ({ url: `${base}/clubs/${c.slug}` })),
  ];
}
