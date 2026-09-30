import { createDb } from "../src/client";
import { dbEnv, isLocalDatabaseUrl } from "../src/env";
import { seedFixtures } from "../src/seed/fixtures";
import { seedTaxonomy } from "../src/seed/taxonomy";

/**
 * pnpm db:seed               — taxonomy + development fixtures (local databases only)
 * pnpm db:seed --taxonomy-only — taxonomy only (safe for any environment)
 */
const taxonomyOnly = process.argv.includes("--taxonomy-only");
const { DATABASE_URL } = dbEnv();
if (!taxonomyOnly && (!isLocalDatabaseUrl(DATABASE_URL) || process.env.NODE_ENV === "production")) {
  console.error("✖ Refusing to load fixture data into a non-local database. Use --taxonomy-only.");
  process.exit(1);
}

const { db, close } = createDb(DATABASE_URL, { max: 1 });
try {
  const categories = await seedTaxonomy(db);
  console.log(`✔ taxonomy: ${categories} categories`);
  if (!taxonomyOnly) {
    const result = await seedFixtures(db);
    console.log(`✔ fixtures: ${result.clubs} demo clubs, ${result.claims} claims (all marked data_origin=fixture)`);
  }
} catch (error) {
  console.error("✖ seed failed:", error);
  process.exitCode = 1;
} finally {
  await close();
}
