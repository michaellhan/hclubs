import { and, eq, like, or } from "drizzle-orm";
import { parseTermKey, slugify } from "@hci/core";
import type { Queryable } from "../client";
import { club, clubSlugHistory, recruitingCycle } from "../schema";

/** Pick a slug not used by any club or retired slug: base, base-2, base-3, … */
export async function uniqueSlug(db: Queryable, base: string): Promise<string> {
  const root = base || "club";
  const taken = new Set(
    [
      ...(await db
        .select({ slug: club.slug })
        .from(club)
        .where(or(eq(club.slug, root), like(club.slug, `${root}-%`)))),
      ...(await db
        .select({ slug: clubSlugHistory.slug })
        .from(clubSlugHistory)
        .where(or(eq(clubSlugHistory.slug, root), like(clubSlugHistory.slug, `${root}-%`)))),
    ].map((r) => r.slug),
  );
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function createClub(
  db: Queryable,
  input: { name: string; slug?: string; dataOrigin?: "ingested" | "fixture" | "editorial" },
): Promise<{ id: string; slug: string }> {
  const slug = await uniqueSlug(db, input.slug ?? slugify(input.name));
  const [row] = await db
    .insert(club)
    .values({ slug, canonicalName: input.name.trim(), dataOrigin: input.dataOrigin ?? "ingested" })
    .returning({ id: club.id, slug: club.slug });
  if (!row) throw new Error("failed to create club");
  return row;
}

/** Get or create the identity row for a club's recruiting cycle. */
export async function ensureRecruitingCycle(
  db: Queryable,
  input: { clubId: string; termKey: string; track?: string },
): Promise<string> {
  const term = parseTermKey(input.termKey);
  if (!term) throw new Error(`Invalid term key: ${input.termKey}`);
  const track = input.track ?? "main";
  await db
    .insert(recruitingCycle)
    .values({ clubId: input.clubId, termKey: input.termKey, year: term.year, season: term.season, track })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: recruitingCycle.id })
    .from(recruitingCycle)
    .where(
      and(
        eq(recruitingCycle.clubId, input.clubId),
        eq(recruitingCycle.termKey, input.termKey),
        eq(recruitingCycle.track, track),
      ),
    );
  if (!row) throw new Error("failed to ensure recruiting cycle");
  return row.id;
}
