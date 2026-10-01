/**
 * Search quality report over the built static index: runs a fixed set of queries a
 * student would type and prints the top results with their match reasons, so ranking
 * changes can be read side by side (diff two runs). Internal; never part of the site.
 *
 *   pnpm --filter @hci/db exec tsx scripts/search-report.ts [index.json] [query…]
 *
 * Default index: apps/web/out/data/index.json (run `pnpm --filter @hci/web build` first).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ClubFilters, reasonText, searchLocal, type StaticIndex } from "../src/local";
import { findRepoRoot } from "../src";

const QUERIES =
  `consulting|consulting group|hccg|hucg|finance|quant|quantitative finance|trading|investment|investing|hedge fund|venture capital|vc|startup|founder|entrepreneurship|ai|machine learning|ml|cs|coding|programming|software|web development|robotics|hardware|engineering|biotech|biology|medicine|premed|pre-med|health|research|math|economics|econ|journalism|newspaper|magazine|writing|comedy|improv|theater|theatre|music|orchestra|jazz|singing|a cappella|acapella|dance|volunteer|tutoring|mentoring|public service|debate|policy|politics|international relations|asia|china|chinese|korea|korean|cultural|christian|jewish|muslim|faith|outdoors|hiking|running|soccer|basketball|gaming|chess|poker|crimson|lampoon|advocate|model un|mun|hasty pudding|consultng|finanace|robitics|programing|jounalism|harvard robotics club|women in business|black students|latinx|pbha|south asian|law|pre-law|film|photography|art|design|climate|environment|sustainability|mental health|religion|sailing|rowing|skiing|ballroom|k-pop|kpop|hip hop|social|first-gen|lgbtq|queer|veterans`.split(
    "|",
  );

const args = process.argv.slice(2);
const file = args[0]?.endsWith(".json") ? args.shift() : undefined;
const index = JSON.parse(
  readFileSync(file ?? join(findRepoRoot(), "apps/web/out/data/index.json"), "utf8"),
) as StaticIndex;
const queries = args.length ? args : QUERIES;
const names = new Map(index.categories.map((c) => [c.slug, c.name]));
const filters = ClubFilters.parse({});
const now = new Date(process.env.NOW ?? "2026-10-01T16:00:00Z");
const TOP = Number(process.env.TOP ?? 8);

for (const q of queries) {
  const r = searchLocal(index.clubs, {
    text: q,
    filters,
    sort: "relevance",
    offset: 0,
    limit: TOP,
    now,
    categoryName: (s) => names.get(s) ?? s,
  });
  const fix = r.corrected ? ` (→ ${r.corrected})` : "";
  console.log(`\n## ${q}${fix} — ${r.total} results${r.partial.length ? `, ${r.partial.length} partial` : ""}`);
  for (const c of r.clubs) {
    const why = (r.reasons[c.id] ?? []).map(reasonText).join("; ");
    console.log(`  ${c.name}${c.acronym ? ` (${c.acronym})` : ""} — ${why}`);
  }
  for (const p of r.partial.slice(0, 3)) console.log(`  ~ ${p.club.name} [${p.matched.join(", ")}]`);
}
