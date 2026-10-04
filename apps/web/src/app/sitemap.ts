import type { MetadataRoute } from "next";
import { getCategories, getClubSlugs } from "@hci/db";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-static";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [{ live }, categories] = await Promise.all([getClubSlugs(db()), getCategories(db())]);
  return [
    ...[
      "/",
      "/clubs/",
      "/about/",
      "/about/methodology/",
      "/about/bot/",
      "/about/glossary/",
      "/contribute/",
      "/for-clubs/",
      "/categories/",
      "/match/",
    ].map((p) => ({
      url: `${base}${p}`,
    })),
    ...categories.filter((c) => c.clubCount > 0).map((c) => ({ url: `${base}/categories/${c.slug}/` })),
    ...live.map((slug) => ({ url: `${base}/clubs/${slug}/` })),
  ];
}
