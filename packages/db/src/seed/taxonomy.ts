import { eq, sql } from "drizzle-orm";
import type { Queryable } from "../client";
import { category } from "../schema";

/**
 * Editorial category taxonomy (not fixture data — safe for production).
 * Parents first; children reference parents by slug. CLAUDE.md §3.
 */
export interface TaxonomyEntry {
  slug: string;
  name: string;
  description?: string;
  parent?: string;
}

export const TAXONOMY: readonly TaxonomyEntry[] = [
  // ADR 0034: browse-friendly names, and technology, health and entrepreneurship moved to
  // the top level (a robotics club is not "pre-professional"). Slugs never change: claims
  // and their provenance refer to them.
  {
    slug: "pre-professional",
    name: "Business & Pre-professional",
    description: "Consulting, finance, law and other career-focused groups.",
  },
  { slug: "consulting", name: "Consulting", parent: "pre-professional" },
  { slug: "finance", name: "Finance & Investing", parent: "pre-professional" },
  { slug: "law", name: "Law", parent: "pre-professional" },
  {
    slug: "technology",
    name: "Technology & Engineering",
    description: "Computer science, software, engineering and robotics groups.",
  },
  { slug: "entrepreneurship", name: "Entrepreneurship", description: "Startups, founders and venture groups." },
  {
    slug: "medicine-health",
    name: "Health & Medicine",
    description: "Pre-med societies, global and public health groups.",
  },
  {
    slug: "academic-stem",
    name: "Academic & Research",
    description: "Subject societies, research, science and engineering.",
  },
  {
    slug: "cultural-identity",
    name: "Cultural & Identity",
    description: "Cultural, ethnic, national, and identity-based communities.",
  },
  { slug: "performing-arts", name: "Arts & Performance", description: "A cappella, dance, theater, and music." },
  { slug: "a-cappella", name: "A cappella", parent: "performing-arts" },
  { slug: "dance", name: "Dance", parent: "performing-arts" },
  { slug: "theater", name: "Theater", parent: "performing-arts" },
  { slug: "music", name: "Music", parent: "performing-arts" },
  {
    slug: "publications-media",
    name: "Publications & Media",
    description: "Newspapers, magazines, journals, radio, and video.",
  },
  {
    slug: "political-advocacy",
    name: "Politics & Policy",
    description: "Political, policy, and advocacy organizations.",
  },
  {
    slug: "public-service",
    name: "Public Service",
    description: "Volunteering, tutoring, mentoring, and community programs.",
  },
  { slug: "mentoring-education", name: "Mentoring & Education", parent: "public-service" },
  { slug: "health-service", name: "Health Services", parent: "public-service" },
  { slug: "adult-services", name: "Adult Services", parent: "public-service" },
  { slug: "advocacy-justice", name: "Advocacy & Justice", parent: "public-service" },
  {
    slug: "competition-teams",
    name: "Competition Teams",
    description: "Debate, mock trial, model UN, robotics, and other competitive teams.",
  },
  { slug: "athletics-recreation", name: "Sports & Recreation", description: "Club sports and recreational groups." },
  { slug: "religious-spiritual", name: "Religious & Spiritual" },
  {
    slug: "social",
    name: "Social & Community",
    description: "Social organizations, including invitation-based groups where public information exists.",
  },
  { slug: "hobbies-games", name: "Hobbies & Games" },
];

/** Idempotent upsert of the taxonomy by slug. */
export async function seedTaxonomy(db: Queryable): Promise<number> {
  let order = 0;
  for (const entry of TAXONOMY) {
    order++;
    let parentId: string | null = null;
    if (entry.parent) {
      const [p] = await db.select({ id: category.id }).from(category).where(eq(category.slug, entry.parent));
      if (!p) throw new Error(`taxonomy: parent ${entry.parent} must precede ${entry.slug}`);
      parentId = p.id;
    }
    await db
      .insert(category)
      .values({
        slug: entry.slug,
        name: entry.name,
        description: entry.description ?? null,
        parentId,
        sortOrder: order,
      })
      .onConflictDoUpdate({
        target: category.slug,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          parentId: sql`excluded.parent_id`,
          sortOrder: sql`excluded.sort_order`,
        },
      });
  }
  return TAXONOMY.length;
}
