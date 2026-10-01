import { getClubProfile, getClubSlugs, publicProfile } from "@hci/db";
import { db } from "@/lib/db";

// One JSON file per club (/data/clubs/<slug>.json), loaded by the compare page.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  // Retired slugs (renamed or merged clubs) get a pointer so old compare links still work.
  const { live, retired } = await getClubSlugs(db());
  return [...live, ...retired].map((slug) => ({ file: `${slug}.json` }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const slug = (await params).file.replace(/\.json$/, "");
  const r = await getClubProfile(db(), slug, new Date());
  if (r.kind === "redirect") return Response.json({ redirect: r.slug });
  if (r.kind !== "found") return new Response("Not found", { status: 404 });
  return Response.json(publicProfile(r.profile));
}
