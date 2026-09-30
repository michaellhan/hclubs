import { JOIN_MODE_LABEL } from "@hci/core";
import { getClubSlugs, getStaticIndex, type StaticIndex } from "@hci/db";
import { db } from "@/lib/db";
import { clubCard } from "@/lib/og";

// One share card per club, written at build time to /og/clubs/<slug>.png (see ../../site.png).
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getClubSlugs(db())).live.map((slug) => ({ file: `${slug}.png` }));
}

// One index query per build worker instead of a profile query per image.
let index: Promise<StaticIndex> | null = null;

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const slug = (await params).file.replace(/\.png$/, "");
  index ??= getStaticIndex(db(), new Date());
  const club = (await index).clubs.find((c) => c.slug === slug);
  if (!club) return new Response("Not found", { status: 404 });
  const chips = [
    ...(club.isFixture ? ["Demo data"] : []),
    ...club.categories.slice(0, 1).map((c) => c.name),
    ...club.joinModes.map((m) => JOIN_MODE_LABEL[m]),
  ].slice(0, 3);
  return clubCard({ name: club.name, acronym: club.acronym, description: club.shortDescription, chips });
}
