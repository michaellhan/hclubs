import { normalizeName, type AffiliationScope, type HarvardSchool } from "@hci/core";
import { htmlToDocument, type PageDocument } from "../parse/document";
import type { ExtractedClaim } from "../types";
import { SENTENCE_BREAK } from "./deterministic";

/**
 * Which part of Harvard an organization belongs to (ADR 0038), from what its own pages or a
 * directory page about it say. PURE.
 *
 * Only self-describing statements count: "X is a GSAS student organization", "membership is
 * open to all HLS students", "a student organization at Harvard Law School", "open to all
 * undergraduates". A mention ("featuring HBS students", "Harvard Law School professor") is
 * not a statement about the organization's membership, and a name ("Harvard Law …") is not
 * evidence at all (CLAUDE.md §3 pitfall).
 *
 * A site the school itself hosts for the group (orgs.law.harvard.edu/<group>) is structural
 * evidence of the school; it is stored as `inferred` and shown as an estimate.
 */
export const SCOPE_EXTRACTOR = { name: "scope-statements", version: "9" } as const;

/**
 * v9: a page about a unit inside another organization ("This chapter is a subsidiary
 * organization under the HCSSA", "This Chapter shall be a subsidiary to the HCSSA") describes
 * that unit, not the club whose site hosts it: it yields no scope at all. The university-wide
 * Harvard CSSA's site has pages about its GSAS chapter; the chapter's school isn't the club's.
 */
const SUBSIDIARY_UNIT =
  /\b(?:is|shall\s+be)\s+a\s+subsidiary\b|\bsubsidiary\s+(?:organi[sz]ation\s+)?(?:under|to|of)\s+the\b/i;

/**
 * Who may join is not which part of Harvard a group belongs to (v3): "open to undergraduate
 * and graduate students, as well as recent graduates, from Harvard and other area
 * universities" (a choir's page) says nothing about the group's own school.
 */
const BEYOND_HARVARD =
  /\b(?:other|area|nearby|neighbou?ring|local)\s+(?:area\s+)?(?:universities|colleges|schools|conservatories)\b|\brecent\s+(?:graduates|alumni)\b|\bnon-Harvard\b/i;

/**
 * v9: who an "open to …" list names. The list runs from "open to" to the end of the clause
 * ("open to undergraduates, and eligibility for graduate students follows …" lists only
 * undergraduates); people named in it beside College students make it a mixed audience.
 */
function openToLists(sentence: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/\bopen\s+to\s+/gi)) {
    const rest = sentence.slice((m.index ?? 0) + m[0].length).split(/[.;!?:()]/)[0] ?? "";
    const cut = rest.search(
      /,?\s+(?:and|but|who|which|that|regardless|with|to|for|in|from|if|whether|so)\s+(?!all\b|both\b|harvard\b|graduate|grads?\b|alumni\b|friends\b|community\b|faculty\b|staff\b|anyone\b|everyone\b|the\s+public\b|postdocs?\b|affiliates\b|non-?harvard\b)/i,
    );
    out.push(cut === -1 ? rest : rest.slice(0, cut));
  }
  return out;
}

/**
 * v9: people beyond Harvard's students in an "open to" list ("open to undergraduates, graduate
 * students, community members, and anyone in between", a Hillel listing; "open to
 * undergraduates, alumni, and friends"): who may come, not where the group belongs. No "open
 * to" rule reads such a sentence, cross-school included.
 */
const BEYOND_STUDENTS =
  /\b(?:alumni|alumnae|friends|community\s+members|anyone|everyone|the\s+public|non-?Harvard|graduates)\b/i;

/**
 * v9: anyone besides College students in an "open to" list ("open to all Harvard College
 * students and graduate students", "undergraduates as well as graduate students",
 * "undergraduates and graduates of any concentration"). Such a list never makes a College-only
 * group; when it names graduate students it reads as cross-school.
 */
const NOT_ONLY_COLLEGE =
  /\b(?:graduate|grad|grads|graduates|postdocs?|faculty|staff|affiliates|alumni|alumnae|friends|community\s+members|anyone|everyone|the\s+public|non-?Harvard)\b/i;

/** "Events are open to …", "the competition is open to …": an audience, not a membership. */
const AUDIENCE_NOT_MEMBERS =
  /\b(events?|competitions?|meetings?|talks?|lectures?|workshops?|panels?|concerts?|shows?|performances?|tickets?|conferences?|sessions?|seminars?|screenings?|programs?|tournaments?)\b[^.!?]{0,60}\bopen\s+to\b/i;

const SCHOOL_NAMES: [HarvardSchool, string][] = [
  ["hls", String.raw`Harvard Law School|Harvard Law|HLS`],
  ["hbs", String.raw`Harvard Business School|HBS`],
  ["hms", String.raw`Harvard Medical School|HMS`],
  ["hsdm", String.raw`Harvard School of Dental Medicine|HSDM`],
  ["hks", String.raw`Harvard Kennedy School|Kennedy School|HKS`],
  [
    "hsph",
    String.raw`Harvard (?:T\.\s?H\.\s)?Chan School of Public Health|Harvard School of Public Health|Harvard Chan|HSPH`,
  ],
  ["gsd", String.raw`Harvard Graduate School of Design|Graduate School of Design|GSD`],
  ["hgse", String.raw`Harvard Graduate School of Education|Graduate School of Education|HGSE|Harvard GSE`],
  ["hds", String.raw`Harvard Divinity School|HDS`],
  [
    "gsas",
    String.raw`Harvard (?:Kenneth C\.\s)?Griffin (?:Graduate School of Arts and Sciences|GSAS)|Graduate School of Arts and Sciences|Griffin GSAS|GSAS`,
  ],
];

const ORG = String.raw`(?:organi[sz]ation|club|group|society|association|org|chapter|initiative|journal|collective)`;
const ADJ = String.raw`(?:[\w-]+\s+){0,3}?`;

interface Rule {
  re: RegExp;
  scope: AffiliationScope;
  school: HarvardSchool | null;
  /** v9: a "<Parent> – <School> Chapter" name; the text before the dash names the parent. */
  chapter?: boolean;
}

function schoolRules(): Rule[] {
  return SCHOOL_NAMES.flatMap(([school, names]) => {
    const n = `(?:the\\s+)?(?:${names})`;
    return [
      // "… is a GSAS student organization", "is the official HLS chapter of …"
      new RegExp(
        String.raw`\b(?:is|are)\s+(?:a|an|the)\s+${ADJ}${n}\s+(?:student[- ]run\s+|student\s+|graduate\s+)?${ORG}\b`,
      ),
      // "… a student organization at Harvard Law School"
      new RegExp(String.raw`\bstudent[- ](?:run\s+)?${ORG}\s+(?:at|of|within|based at)\s+${n}\b`),
      // "membership is open to all HLS students", "open to all matriculated HBS students"
      new RegExp(
        String.raw`\bopen\s+to\s+(?:all\s+)?(?:current\s+|matriculated\s+|enrolled\s+|registered\s+)?${n}\s+(?:students|community)\b`,
      ),
      // "Each student club at Harvard Business School (HBS) is open to …" (school directories)
      new RegExp(String.raw`\b(?:each|every)\s+student\s+${ORG}\s+at\s+${n}\b`),
      // v6: "HGWISE at Harvard University GSAS is a graduate student organization"
      new RegExp(String.raw`\bat\s+(?:Harvard\s+(?:University\s+)?)?${n}\s+(?:is|are)\s+(?:a|an|the)\s+${ADJ}${ORG}\b`),
      // v8: the group's own name says it's that school's chapter ("Harvard CSSA – Graduate
      // School of Arts and Sciences Chapter") or spells its acronym out as the school's
      // ("HIVE (Harvard GSE Innovation and Ventures in Education)").
      new RegExp(String.raw`\(\s*${n}\s+[A-Z][a-z]+(?:\s+(?:and|of|in|for|[A-Z][a-z]+))+\s*\)`),
    ]
      .map((re): Rule => ({ re, scope: "graduate_school", school }))
      .concat({
        re: new RegExp(String.raw`[–—-]\s*${n}\s+Chapter\b`),
        scope: "graduate_school",
        school,
        chapter: true,
      });
  });
}

const COLLEGE = String.raw`(?:Harvard\s+College|Harvard\s+undergraduate|undergraduate)`;
const MEMBERS_VERB = String.raw`(?:open\s+to|welcomes?|members?\s+(?:include|are)|membership\s+(?:includes|is\s+open\s+to)|comprised\s+of|consists\s+of|brings?\s+together)`;
const UNDERGRADS = String.raw`(?:Harvard\s+College\s+students|(?:Harvard\s+)?(?:College\s+)?undergrad(?:uate)?s?(?:\s+students)?)`;
const RULES: Rule[] = [
  ...schoolRules(),
  // "… is an undergraduate student organization", "is a student-run Harvard College club"
  {
    re: new RegExp(
      String.raw`\b(?:is|are)\s+(?:a|an|the)\s+${ADJ}${COLLEGE}\s+(?:student[- ]run\s+|student\s+)?${ORG}\b`,
      "i",
    ),
    scope: "harvard_college",
    school: "college",
  },
  {
    re: new RegExp(String.raw`\bstudent[- ](?:run\s+)?${ORG}\s+(?:at|of)\s+Harvard\s+College\b`, "i"),
    scope: "harvard_college",
    school: "college",
  },
  {
    re: /\bopen\s+to\s+(?:all\s+)?(?:current\s+)?(?:Harvard\s+)?(?:College\s+)?undergrad(?:uate)?s\b|\bopen\s+to\s+(?:all\s+)?(?:current\s+)?(?:Harvard\s+College|Harvard\s+undergraduate|undergraduate)\s+students\b/i,
    scope: "harvard_college",
    school: "college",
  },
  // v4/v5, from program pages that describe their own members: "an undergraduate-run think
  // tank", "spearheaded by undergraduate students", "a hub for all Harvard College students",
  // "Harvard College students only", "recruits and trains … undergraduate students".
  // "Student-run" alone says nothing about the school (graduate clubs are student-run too),
  // and "led by Harvard undergraduates <names>" describes leaders, not the group (v5).
  {
    re: /\b(?:a|an|the)\s+(?:[\w-]+\s+){0,2}?undergraduate-run\s+(?:[\w-]+\s+){0,2}?(?:think\s+tank|organi[sz]ation|club|group|program|publication|magazine|journal|team|company|ensemble|society)\b/i,
    scope: "harvard_college",
    school: "college",
  },
  {
    re: /\b(?:run|spearheaded|staffed|managed)\s+(?:entirely\s+|exclusively\s+)?by\s+(?:Harvard\s+)?(?:College\s+)?undergrad(?:uate)?(?:s|\s+students)\b/i,
    scope: "harvard_college",
    school: "college",
  },
  {
    re: /\b(?:hub|home|community|space)\s+for\s+(?:all\s+)?Harvard\s+College\s+students\b|\bHarvard\s+College\s+students\s+only\b|\brecruits\s+(?:and\s+trains\s+)?(?:[\w-]+\s+){0,2}?(?:Harvard\s+)?undergraduate\s+students\b/i,
    scope: "harvard_college",
    school: "college",
  },
  {
    re: /\b(?:officially\s+)?recogni[sz]ed\s+(?:student\s+organi[sz]ation\s+)?(?:by|at)\s+Harvard\s+College\b/i,
    scope: "harvard_college",
    school: "college",
  },
  // v6: graduate and Extension School groups describing their own members. The Extension
  // School and its post-baccalaureate programs aren't the College; they're filed under
  // graduate_school (v7: with the Extension School as their school, so they aren't called
  // "graduate-school" groups).
  {
    re: /\b(?:is|are)\s+(?:a|an|the)\s+(?:[\w-]+\s+){0,2}?graduate[- ]student\s+(?:organi[sz]ation|club|group|society|association)\b/i,
    scope: "graduate_school",
    school: null,
  },
  {
    re: /\b(?:body|club|organi[sz]ation|association|group|society)\s+(?:for|of)\s+(?:all\s+)?(?:Harvard\s+)?Extension\s+School\s+students\b/i,
    scope: "graduate_school",
    school: "extension",
  },
  // The sentence doesn't name the school running the program: no school.
  {
    re: /^\W*Post-?Baccalaureate\s+student\s+(?:club|organi[sz]ation|group|society)\b/i,
    scope: "graduate_school",
    school: null,
  },
  // Membership across schools, stated as such, in either order (v9: "both", "as well as",
  // "Harvard College students", "undergrads").
  {
    re: new RegExp(
      String.raw`\b${MEMBERS_VERB}\s+(?:both\s+)?(?:all\s+)?${UNDERGRADS}\s*(?:,|\band\b|&|\bas\s+well\s+as\b)\s*(?:all\s+)?(?:Harvard\s+)?(?:graduate|grad)\s+students\b|\b${MEMBERS_VERB}\s+(?:both\s+)?(?:all\s+)?(?:Harvard\s+)?(?:graduate|grad)(?:\s+students)?\s*(?:,|\band\b|&|\bas\s+well\s+as\b)\s*(?:all\s+)?${UNDERGRADS}`,
      "i",
    ),
    scope: "cross_school",
    school: null,
  },
  {
    re: /\bopen\s+to\s+(?:all\s+)?(?:Harvard\s+)?(?:University\s+)?(?:students|affiliates)\s+(?:from|across|in|at)\s+(?:all|any|every)\s+(?:of\s+)?(?:Harvard'?s\s+|the\s+)?(?:schools|graduate\s+schools|Harvard\s+schools)\b|\buniversity[- ]wide\s+(?:student\s+)?(?:organi[sz]ation|club|group)\b/i,
    scope: "university_wide",
    school: null,
  },
];

/** Hosts (and paths) a Harvard school runs for its own student groups. */
const SCHOOL_HOSTS: [RegExp, HarvardSchool][] = [
  [/^(?:orgs|clinics|students?)\.law\.harvard\.edu$/, "hls"],
  [/^(?:www\.)?hbs\.edu$/, "hbs"],
  [/^(?:[\w-]+\.)*hsph\.harvard\.edu$/, "hsph"],
  [/^(?:[\w-]+\.)*hks\.harvard\.edu$/, "hks"],
  [/^(?:[\w-]+\.)*gsd\.harvard\.edu$/, "gsd"],
  [/^(?:[\w-]+\.)*gse\.harvard\.edu$/, "hgse"],
  [/^(?:[\w-]+\.)*hds\.harvard\.edu$/, "hds"],
  [/^(?:[\w-]+\.)*hms\.harvard\.edu$/, "hms"],
];
/** Paths under a school host that are its student-group pages (not the school's own news). */
const SCHOOL_GROUP_PATH: Partial<Record<HarvardSchool, RegExp>> = {
  hbs: /\/student-clubs\//,
};

function sentencesOf(doc: PageDocument): { sentence: string; block: number }[] {
  return doc.blocks.flatMap((b) =>
    b.text
      .split(SENTENCE_BREAK)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12 && s.length <= 600)
      .map((sentence) => ({ sentence, block: b.index })),
  );
}

/** The school a group's own site is hosted by, when the school hosts it. PURE. */
export function schoolHostOf(url: string): HarvardSchool | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  for (const [re, school] of SCHOOL_HOSTS) {
    if (!re.test(host)) continue;
    const path = SCHOOL_GROUP_PATH[school];
    if (path && !path.test(u.pathname)) return null;
    return school;
  }
  return null;
}

export interface ScopeFinding {
  scope: AffiliationScope;
  school: HarvardSchool | null;
  quote: string;
  block: number | null;
}

/**
 * v9: whether the text just before a "– <School> Chapter" match ends with one of the club's own
 * names: then the sentence names the club's chapter (a unit of the club), not the club. PURE.
 */
function namesClubAsParent(sentence: string, rule: Rule, clubNames: readonly string[]): boolean {
  const m = rule.re.exec(sentence);
  if (!m) return false;
  const parent = ` ${normalizeName(sentence.slice(0, m.index))}`;
  return clubNames.some((n) => {
    const name = normalizeName(n);
    return name.length >= 3 && parent.endsWith(` ${name}`);
  });
}

/**
 * Self-describing scope statements on one page. `clubNames` (the club's name, aliases and
 * acronyms) let a chapter's name be told from the club's own (v9). PURE.
 */
export function scopeStatements(doc: PageDocument, clubNames: readonly string[] = []): ScopeFinding[] {
  const out: ScopeFinding[] = [];
  const seen = new Set<string>();
  const sentences = sentencesOf(doc);
  if (sentences.some((s) => SUBSIDIARY_UNIT.test(s.sentence))) return out;
  for (const { sentence, block } of sentences) {
    const lists = openToLists(sentence);
    const audience =
      AUDIENCE_NOT_MEMBERS.test(sentence) ||
      BEYOND_HARVARD.test(sentence) ||
      lists.some((l) => BEYOND_STUDENTS.test(l));
    const mixed = lists.some((l) => NOT_ONLY_COLLEGE.test(l));
    for (const rule of RULES) {
      if (!rule.re.test(sentence)) continue;
      if (audience && rule.re.source.includes(String.raw`open\s+to`)) continue;
      if (rule.chapter && namesClubAsParent(sentence, rule, clubNames)) continue;
      if (mixed && rule.scope === "harvard_college" && rule.re.source.includes(String.raw`open\s+to`)) continue;
      const key = `${rule.scope}:${rule.school ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ scope: rule.scope, school: rule.school, quote: sentence, block });
    }
  }
  return out;
}

/**
 * Scope claims for one page. Statements become `stated` claims; a school-hosted own site
 * adds `inferred` ones. A page whose statements point at more than one scope says nothing
 * we can use (e.g. a club that lists partner groups), so it yields no stated scope.
 */
export function extractScope(input: ScopeInput): ExtractedClaim[] {
  return scopeClaims(input).map((c) => ({ ...c, extractor: SCOPE_EXTRACTOR }));
}

interface ScopeInput {
  doc: PageDocument;
  ownSite: boolean;
  /** The club's name, aliases and acronyms (v9). */
  clubNames?: readonly string[];
}

/**
 * Scope statements in a directory's description of one organization (v9): a listing's
 * "HIVE (Harvard GSE Innovation and Ventures in Education) is dedicated to …" is the
 * directory's statement about that organization, read with the same rules as a page. The
 * claims carry the locator the adapter gives and this extractor's identity; the quote is the
 * sentence, verbatim. PURE.
 */
export function listingScopeClaims(
  description: string,
  input: { clubNames: readonly string[]; locator: Record<string, unknown> },
): ExtractedClaim[] {
  const escaped = description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const doc = htmlToDocument(`<html><body><main><p>${escaped}</p></main></body></html>`, "https://listing.invalid/");
  return scopeClaims({ doc, ownSite: false, clubNames: input.clubNames }).map((c) => ({
    ...c,
    locator: input.locator,
    // Evidence names this extractor and its version, not the adapter's: a scope-rule change
    // then shows as a new scope-statements version that `retract-unreproduced` can act on.
    extractor: SCOPE_EXTRACTOR,
  }));
}

function scopeClaims(input: ScopeInput): ExtractedClaim[] {
  const found = scopeStatements(input.doc, input.clubNames);
  const scopes = new Set(found.map((f) => f.scope));
  const out: ExtractedClaim[] = [];
  const locator = (f: ScopeFinding) => ({ url: input.doc.url, ...(f.block !== null ? { block: f.block } : {}) });
  if (scopes.size === 1) {
    const first = found[0];
    if (first)
      out.push({
        fieldKey: "club.affiliation_scope",
        value: first.scope,
        assertionKind: "stated",
        isDirect: true,
        extractionMethod: "html_parse",
        quote: first.quote,
        locator: locator(first),
      });
    for (const f of found)
      if (f.school)
        out.push({
          fieldKey: "club.school",
          value: f.school,
          assertionKind: "stated",
          isDirect: true,
          extractionMethod: "html_parse",
          quote: f.quote,
          locator: locator(f),
        });
  }
  if (input.ownSite) {
    const school = schoolHostOf(input.doc.url);
    if (school) {
      const base = {
        assertionKind: "inferred" as const,
        isDirect: false,
        extractionMethod: "html_parse" as const,
        locator: { url: input.doc.url, signal: "site hosted by the school for its student groups" },
      };
      out.push({ ...base, fieldKey: "club.school", value: school });
      out.push({ ...base, fieldKey: "club.affiliation_scope", value: "graduate_school" });
    }
  }
  return out;
}
