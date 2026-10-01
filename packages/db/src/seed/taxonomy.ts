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
  {
    slug: "consulting",
    name: "Consulting",
    parent: "pre-professional",
    description: "Student consulting groups that take on projects for companies and nonprofits.",
  },
  {
    slug: "finance",
    name: "Finance & Investing",
    parent: "pre-professional",
    description: "Investing, trading, banking and finance-career groups.",
  },
  {
    slug: "law",
    name: "Law",
    parent: "pre-professional",
    description: "Pre-law societies, law reviews and legal-advocacy groups.",
  },
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
  {
    slug: "a-cappella",
    name: "A cappella",
    parent: "performing-arts",
    description: "Unaccompanied singing groups, most of which audition.",
  },
  {
    slug: "dance",
    name: "Dance",
    parent: "performing-arts",
    description: "Dance companies and troupes, from ballet to cultural dance.",
  },
  {
    slug: "theater",
    name: "Theater",
    parent: "performing-arts",
    description: "Theater, musical theater, comedy and improv groups.",
  },
  {
    slug: "music",
    name: "Music",
    parent: "performing-arts",
    description: "Orchestras, bands, choirs and other instrumental and vocal ensembles.",
  },
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
  {
    slug: "mentoring-education",
    name: "Mentoring & Education",
    parent: "public-service",
    description: "Tutoring, mentoring and education programs for young people and adults.",
  },
  {
    slug: "health-service",
    name: "Health Services",
    parent: "public-service",
    description: "Volunteer programs in health care and health education.",
  },
  {
    slug: "adult-services",
    name: "Adult Services",
    parent: "public-service",
    description: "Programs serving adults: shelters, ESL, citizenship and prison education.",
  },
  {
    slug: "advocacy-justice",
    name: "Advocacy & Justice",
    parent: "public-service",
    description: "Service programs working on legal, housing and social-justice issues.",
  },
  {
    slug: "competition-teams",
    name: "Competition Teams",
    description: "Debate, mock trial, model UN, robotics, and other competitive teams.",
  },
  { slug: "athletics-recreation", name: "Sports & Recreation", description: "Club sports and recreational groups." },
  {
    slug: "religious-spiritual",
    name: "Religious & Spiritual",
    description: "Faith communities, fellowships and interfaith groups.",
  },
  {
    slug: "social",
    name: "Social & Community",
    description: "Social organizations, including invitation-based groups where public information exists.",
  },
  {
    slug: "hobbies-games",
    name: "Hobbies & Games",
    description: "Games, outdoor pursuits, crafts and other interests for fun.",
  },
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
