import { findDuplicatePairs } from "../../name-only/identity";
import { plain } from "../text";
import type { AuditClub, AuditData, AuditFinding } from "../types";

/**
 * Duplicate / rename detection over every active club. PURE. Only an exact match of the
 * normalized name (spelling, plural, "&"/"and", "Harvard …" prefixes, "PBHA's", "(Club
 * Sport)", an "(ACRONYM)" expansion) or one club's alias being the other's name counts as
 * high confidence; shared links, initialisms and identical text are proposals for review.
 */

const NAME_NOISE = new Set([
  "harvard",
  "radcliffe",
  "college",
  "undergraduate",
  "undergraduates",
  "university",
  "the",
  "of",
  "at",
  "club",
  "society",
  "association",
  "organization",
  "organisation",
  "group",
  "chapter",
  "program",
  "programs",
  "pbha",
  "inc",
  "student",
  "students",
  "hc",
  "hu",
]);

const stemWord = (w: string) =>
  w.length > 5 && w.endsWith("ies")
    ? `${w.slice(0, -3)}y`
    : w.length > 5 && w.endsWith("ing")
      ? w.slice(0, -3)
      : w.length > 3 && w.endsWith("s") && !w.endsWith("ss")
        ? w.slice(0, -1)
        : w;

/** Spellings of a name that should compare equal ("Skiing (Club Sport)" = "Harvard Ski Club"). PURE. */
export function nameKeys(name: string): string[] {
  const variants = new Set<string>([name.replace(/\([^)]*\)/g, " ")]);
  // "Boston Refugee Youth Enrichment (BRYE) Tutoring" → "BRYE Tutoring".
  const m = name.match(/^(.*?)\s*\((\w{2,})\)(.*)$/);
  if (m?.[2]) {
    const before = (m[1] ?? "").trim().split(/\s+/);
    const acr = m[2].toLowerCase();
    for (let k = 1; k <= Math.min(6, before.length); k++) {
      const initials = before
        .slice(-k)
        .map((w) => w[0]?.toLowerCase())
        .join("");
      if (initials === acr) variants.add(`${before.slice(0, -k).join(" ")} ${m[2]} ${m[3] ?? ""}`);
    }
  }
  const keys = new Set<string>();
  for (const v of variants) {
    const toks = plain(v)
      .split(" ")
      .filter((t) => t && !NAME_NOISE.has(t))
      .map(stemWord);
    if (toks.some((t) => t.length >= 3)) keys.add([...new Set(toks)].sort().join(" "));
  }
  return [...keys];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function checkDuplicates(data: AuditData): AuditFinding[] {
  const clubs = [...data.clubs.values()];
  const weight = new Map<string, number>();
  for (const c of data.claims) weight.set(c.clubId, (weight.get(c.clubId) ?? 0) + c.evidence.length);
  const out = new Map<string, AuditFinding>();
  const add = (a: AuditClub, b: AuditClub, confidence: AuditFinding["confidence"], why: string) => {
    const key = pairKey(a.id, b.id);
    if (data.decidedPairs.has(key)) return;
    const prev = out.get(key);
    if (prev && (prev.confidence === "high" || confidence !== "high")) {
      if (!prev.detail.includes(why)) prev.detail += `; ${why}`;
      return;
    }
    // The club with more evidence survives (the other's claims follow it; reversible); on a
    // tie, the one with the fuller name ("The Harvard Undergraduate Drummers" over "HarvardTHUD").
    const wa = weight.get(a.id) ?? 0;
    const wb = weight.get(b.id) ?? 0;
    const aWins =
      wa !== wb
        ? wa > wb
        : a.name.split(/\s+/).length !== b.name.split(/\s+/).length
          ? a.name.split(/\s+/).length > b.name.split(/\s+/).length
          : a.id < b.id;
    const [survivor, absorbed] = aWins ? [a, b] : [b, a];
    out.set(key, {
      check: confidence === "high" ? "duplicate.same_organization" : "duplicate.candidate",
      area: "duplicate",
      severity: "high",
      confidence,
      clubId: absorbed.id,
      slug: absorbed.slug,
      subject: `${absorbed.slug} → ${survivor.slug}`,
      detail: prev ? `${why}; ${prev.detail}` : why,
      displayed: true,
      fix:
        confidence === "high"
          ? { kind: "merge", absorbedId: absorbed.id, survivorId: survivor.id, reason: `audit duplicate: ${why}` }
          : null,
    });
  };

  // Same normalized name.
  const byKey = new Map<string, AuditClub[]>();
  for (const c of clubs) for (const k of nameKeys(c.name)) byKey.set(k, [...(byKey.get(k) ?? []), c]);
  for (const [k, cs] of byKey)
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++)
        add(cs[i]!, cs[j]!, "high", `same name once spelling and prefixes are set aside ("${k}")`);

  // One club's alias is the other's name.
  const byName = new Map<string, AuditClub[]>();
  for (const c of clubs) byName.set(plain(c.name), [...(byName.get(plain(c.name)) ?? []), c]);
  for (const c of clubs)
    for (const alias of c.projectedAliases)
      for (const o of byName.get(plain(alias)) ?? [])
        if (o.id !== c.id) add(c, o, "high", `"${o.name}" is an alias of "${c.name}"`);

  // A club whose own description is just another club's name ("HarvardTHUD": "(The Harvard
  // Undergraduate Drummers)"), or opens with it while the two share a link (a rename).
  const linkSet = (id: string) => new Set(data.links.filter((l) => l.clubId === id).map((l) => l.normalizedUrl));
  for (const c of clubs) {
    const d = plain(c.shortDescription);
    if (!d) continue;
    for (const o of byName.get(d) ?? [])
      if (o.id !== c.id) add(c, o, "high", `"${c.name}" is described only as "${o.name}"`);
    for (const o of clubs) {
      if (o.id === c.id || plain(o.name).split(" ").length < 3 || !d.startsWith(plain(o.name))) continue;
      const mine = linkSet(c.id);
      const shared = [...linkSet(o.id)].filter((u) => mine.has(u));
      if (shared.length) add(c, o, "high", `"${c.name}" describes itself as "${o.name}" and shares ${shared[0]}`);
    }
  }

  // Shared accounts plus one club's whole name being the other's handle: "HCURA" and
  // linkedin.com/company/hcura on the Harvard Undergraduate Research Association, which also
  // shares its Facebook page; "HarvardTHUD" and the Drummers' facebook.com/harvardthud.
  const flatName = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  const handlesOf = (cid: string) =>
    new Set(
      data.links
        .filter((l) => l.clubId === cid && l.kind !== "website")
        .map((l) =>
          (l.handle ?? l.normalizedUrl.split("/").filter(Boolean).pop() ?? "")
            .toLowerCase()
            .replace(/^@/, "")
            .replace(/[^a-z0-9]/g, ""),
        ),
    );
  for (const c of clubs) {
    const own = flatName(c.name);
    if (own.length < 4 || c.name.trim().includes(" ")) continue;
    const mine = linkSet(c.id);
    for (const o of clubs) {
      if (o.id === c.id || !handlesOf(o.id).has(own)) continue;
      const shared = [...linkSet(o.id)].filter((u) => mine.has(u));
      if (shared.length)
        add(c, o, "high", `"${o.name}" uses the handle "${own}" and shares ${shared[0]} with "${c.name}"`);
    }
  }

  // Shared links and initialisms (the name-only finder, over every club).
  const linksOf = (id: string, kind: string) =>
    data.links.filter((l) => l.clubId === id && l.kind === kind).map((l) => l.url);
  const pairs = findDuplicatePairs(
    clubs.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      acronym: c.acronym,
      websites: linksOf(c.id, "website"),
      instagrams: linksOf(c.id, "instagram"),
    })),
    new Set(clubs.map((c) => c.id)),
  );
  for (const p of pairs) {
    const a = data.clubs.get(p.aId);
    const b = data.clubs.get(p.bId);
    if (a && b) add(a, b, "medium", p.reasons.join("; "));
  }

  // Identical descriptions.
  const byText = new Map<string, AuditClub[]>();
  for (const c of clubs) {
    const t = plain(c.shortDescription);
    if (t.length >= 40) byText.set(t, [...(byText.get(t) ?? []), c]);
  }
  for (const cs of byText.values())
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) add(cs[i]!, cs[j]!, "medium", "identical description");

  // A name that is the other's name plus one qualifier is a sibling more often than a
  // duplicate ("… Summer" / "… Term", men's / women's); report it for review only.
  for (const a of clubs)
    for (const b of clubs) {
      if (a.id >= b.id) continue;
      const ka = nameKeys(a.name)[0]?.split(" ") ?? [];
      const kb = nameKeys(b.name)[0]?.split(" ") ?? [];
      if (ka.length < 2 || kb.length < 2) continue;
      const [small, big] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
      if (big.length - small.length === 1 && small.every((t) => big.includes(t)))
        add(a, b, "low", `one name is the other plus "${big.find((t) => !small.includes(t))}"`);
    }
  return [...out.values()];
}
