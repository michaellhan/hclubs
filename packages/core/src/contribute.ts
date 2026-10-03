import type { FieldKey } from "./fields/registry";
import type {
  DateValue,
  DuesValue,
  HoursPerWeek,
  LinkValue,
  MembershipEstimate,
  RecruitingSeason,
} from "./fields/values";
import type { JoinMode, LinkKind } from "./enums";
import { classifyLink, extractInstagramHandle } from "./normalize/social";
import { parseDateExpression, parseTermExpression } from "./timeparse";
import { termForDate, termKey } from "./terms";
import { OFFICER_FORM_OPTION, PROMPT_LABEL as L } from "./officer";

export { OFFICER_FORM_OPTION, clubReference, officerDetails, type OfficerAnswers } from "./officer";

/**
 * Community contributions (CLAUDE.md §14, ADR 0035). The site sends students to an
 * external form (a Google Form) with the club, the contribution type and a short answer
 * template prefilled. The template's "Label: value" lines are how a response becomes
 * structured: on import each answered line is parsed into a *proposed* field value that an
 * editor accepts or rejects one by one. Nothing here writes data. PURE, browser-safe.
 */

export const CONTRIBUTION_TYPES = [
  "missing_info",
  "missing_club",
  "incorrect_info",
  "website",
  "instagram",
  "deadline",
  "application_link",
  "joining_process",
  "member_count",
  "dues",
  "time_commitment",
  "eligibility",
  "inactive",
  "renamed",
  "duplicate",
  "club_manager",
  "other",
] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

/** Template line: what the form asks, and the field its answer proposes. */
interface Prompt {
  /** Line label the submitter answers after; matched case-insensitively on import. */
  label: string;
  /** Example or hint shown in parentheses; not part of the matched label. */
  hint?: string;
  parse: ProposalParser | null;
}

interface ContributionTypeDef {
  key: ContributionType;
  /** Shown on the site's "Suggest an edit" menu. */
  label: string;
  /**
   * The answer to the form's "What kind of update?" question this type preselects. It must
   * equal one of the live form's options exactly, or Google leaves the question blank.
   */
  formOption: string;
  prompts: Prompt[];
}

/**
 * One parsed answer: a value for a registry field (or the "duplicate_of" action), or null
 * when the answer couldn't be read and the editor must supply one. `raw` is always kept.
 */
export interface ProposedField {
  label: string;
  fieldKey: FieldKey | "duplicate_of";
  raw: string;
  value: unknown;
  /** Recruiting term for cycle fields ("2026-fall"). */
  termKey?: string;
  /** Why the value is null, or what the reviewer should double-check. */
  note?: string;
}

type ProposalParser = (raw: string, ctx: ParseContext) => Omit<ProposedField, "label" | "raw">[];

interface ParseContext {
  submittedAt: Date;
  /** Answers by normalized label, for parsers that read a sibling line (the term). */
  answers: Map<string, string>;
}

// --- Value parsers (deterministic; null when unsure) ------------------------------------------

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const APPROX = /\b(about|around|approx(?:imately)?|roughly|maybe|~|ca\.?)\s*/i;

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "3-5", "3 to 5", "about 4", "4", "under 2", "10+" → bounds. PURE. */
export function parseRange(raw: string): { min: number | null; max: number | null; approx: boolean } | null {
  const t = raw.toLowerCase().replace(/,/g, "");
  const approx = APPROX.test(t);
  let m = t.match(new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}`));
  if (m) {
    const a = num(m[1]);
    const b = num(m[2]);
    return a !== null && b !== null && a <= b ? { min: a, max: b, approx } : null;
  }
  m = t.match(new RegExp(`(?:under|less than|fewer than|at most|up to|<)\\s*${NUM}`));
  if (m) return { min: null, max: num(m[1]), approx };
  m = t.match(new RegExp(`(?:over|more than|at least|>)\\s*${NUM}|${NUM}\\s*\\+`));
  if (m) return { min: num(m[1] ?? m[2]), max: null, approx };
  const all = t.match(new RegExp(NUM, "g"));
  if (all?.length === 1) {
    const n = num(all[0]);
    return { min: n, max: n, approx };
  }
  return null;
}

const one = (fieldKey: FieldKey, value: unknown, note?: string): Omit<ProposedField, "label" | "raw">[] => [
  { fieldKey, value, ...(note ? { note } : {}) },
];

const unread = (fieldKey: FieldKey | "duplicate_of", note: string) => [{ fieldKey, value: null, note }];

function linkValue(raw: string, expect: LinkKind | null): LinkValue | string {
  const url = raw.trim().match(/https?:\/\/\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?\S*/i)?.[0];
  if (!url) return "no link found";
  const c = classifyLink(/^https?:/i.test(url) ? url : `https://${url}`);
  if (!c) return "not a valid link";
  if (c.isPersonal) return "points at a person, not the club";
  if (c.isContentItem) return "points at a single post, not the account";
  if (expect === "website" && c.kind !== "website" && c.kind !== "other") return `looks like ${c.kind}, not a website`;
  const kind: LinkKind = expect === "website" ? "website" : c.kind;
  return { kind, url: c.url, ...(c.handle ? { handle: c.handle } : {}) };
}

const FORM_HOST =
  /(docs\.google\.com\/forms|forms\.gle|typeform\.com|airtable\.com|jotform\.com|tally\.so|forms\.office\.com)/i;

const parseWebsite: ProposalParser = (raw) => {
  const v = linkValue(raw, "website");
  return typeof v === "string" ? unread("club.link", v) : one("club.link", v);
};

const parseInstagram: ProposalParser = (raw) => {
  const handle = extractInstagramHandle(raw.trim().split(/\s+/)[0] ?? "");
  if (!handle) return unread("club.link", "no Instagram handle or profile link found");
  const v: LinkValue = { kind: "instagram", url: `https://www.instagram.com/${handle}/`, handle };
  return one("club.link", v);
};

/** A website, or an Instagram handle or link. */
const parseAnyLink: ProposalParser = (raw, ctx) => {
  const t = raw.trim();
  return /instagram|^@/i.test(t) ? parseInstagram(t, ctx) : parseWebsite(t, ctx);
};

const parseApplicationLink: ProposalParser = (raw) => {
  const v = linkValue(raw, null);
  if (typeof v === "string") return unread("club.link", v);
  const kind: LinkKind = FORM_HOST.test(v.url) ? "application_form" : "application_page";
  return one("club.link", { ...v, kind });
};

function termOf(ctx: ParseContext, date: DateValue | null): { termKey: string; note?: string } | null {
  const said = ctx.answers.get("term");
  if (said) {
    const t = parseTermExpression(said, ctx.submittedAt);
    if (t) return { termKey: t.termKey };
  }
  if (!date) return null;
  // A deadline belongs to the term it falls in; flagged so the reviewer confirms.
  const at = date.precision === "date" ? new Date(`${date.at}T12:00:00Z`) : new Date(date.at);
  return { termKey: termKey(termForDate(at)), note: "term taken from the deadline's date; confirm" };
}

const parseDeadline: ProposalParser = (raw, ctx) => {
  const d = parseDateExpression(raw, ctx.submittedAt);
  if (!d) return unread("cycle.deadline", "no date found");
  const value: DateValue = {
    at: d.at,
    precision: d.precision,
    sourceText: d.originalText.slice(0, 300),
    parseConfidence: d.confidence,
  };
  const term = termOf(ctx, value);
  const notes = [...d.notes, ...(term?.note ? [term.note] : []), ...(term ? [] : ["no term; pass --term"])];
  return [
    {
      fieldKey: "cycle.deadline",
      value,
      ...(term ? { termKey: term.termKey } : {}),
      ...(notes.length ? { note: notes.join("; ") } : {}),
    },
  ];
};

const JOIN_WORDS: [RegExp, JoinMode][] = [
  [/\b(open|anyone|no (application|comp|audition)|just show up|drop[- ]in)\b/i, "open"],
  [/\bappl(y|ication)\b/i, "application"],
  [/\bcomp(ing|s)?\b/i, "comp"],
  [/\baudition/i, "audition"],
  [/\btry-?outs?\b/i, "tryout"],
  [/\binvit(e|ation)/i, "invite_only"],
];

/** Join modes an answer names. "open" only when nothing selective is named. PURE. */
export function parseJoinModes(raw: string): JoinMode[] {
  // "no audition", "without an application" name a process only to rule it out.
  const said = raw.replace(
    /\b(no|without|not an?|doesn'?t (require|need) an?|don'?t (require|need) an?)\s+(an?\s+)?(application|comp|audition|tryout)s?\b/gi,
    " open ",
  );
  const found = JOIN_WORDS.filter(([re]) => re.test(said)).map(([, m]) => m);
  const selective = found.filter((m) => m !== "open");
  return selective.length ? selective : found;
}

const parseJoin: ProposalParser = (raw) => {
  const modes = parseJoinModes(raw);
  return modes.length
    ? modes.map((m) => ({ fieldKey: "club.join_mode" as const, value: m }))
    : unread("club.join_mode", "no joining process named (open, application, comp, audition, tryout, invite)");
};

const parseMembers: ProposalParser = (raw) => {
  const r = parseRange(raw);
  if (!r || (r.min === null && r.max === null)) return unread("club.member_count", "no number found");
  if ([r.min, r.max].some((n) => n !== null && (!Number.isInteger(n) || n > 5000)))
    return unread("club.member_count", "not a plausible member count");
  const v: MembershipEstimate =
    r.min !== null && r.min === r.max && !r.approx
      ? { kind: "exact", count: r.min }
      : { kind: "range", min: r.min, max: r.max };
  return one("club.member_count", v, r.approx ? "approximate" : undefined);
};

/** "$50 a semester", "none", "free", "$0" → dues. PURE. */
export function parseDues(raw: string): DuesValue | null {
  const t = raw.trim();
  if (/^(none|no( dues)?|free|nothing|n\/a|\$?0(\.00)?)\b/i.test(t) || /\bno dues\b/i.test(t))
    return { hasDues: false };
  const m = t.match(/\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd)\b/i);
  const amount = num(m?.[1] ?? m?.[2]);
  if (amount !== null) {
    const note = t
      .replace(m?.[0] ?? "", "")
      .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
      .slice(0, 200);
    return { hasDues: amount > 0, amountUsd: amount, ...(note ? { note } : {}) };
  }
  if (/^yes\b/i.test(t)) return { hasDues: true };
  return null;
}

const parseDuesAnswer: ProposalParser = (raw) => {
  const v = parseDues(raw);
  return v ? one("club.dues", v) : unread("club.dues", "no amount or 'none' found");
};

function hours(qualifier: HoursPerWeek["qualifier"]): ProposalParser {
  return (raw) => {
    const r = parseRange(raw);
    if (!r || [r.min, r.max].some((n) => n !== null && n > 80)) return unread("club.hours_per_week", "no hours found");
    const v: HoursPerWeek = { min: r.min, max: r.max, ...(qualifier ? { qualifier } : {}) };
    return one("club.hours_per_week", v, r.approx ? "approximate" : undefined);
  };
}

const parseEligibility: ProposalParser = (raw) => {
  const out: Omit<ProposedField, "label" | "raw">[] = [];
  const firstYears = /\b(first[- ]?years?|freshm[ae]n|frosh|class of 20\d\d)\b/i;
  if (/\b(all|any) (undergrad|student|class)/i.test(raw) || /\banyone\b/i.test(raw))
    out.push({ fieldKey: "club.freshmen_eligible", value: true });
  else if (firstYears.test(raw))
    out.push({
      fieldKey: "club.freshmen_eligible",
      value: !/\b(no|not|except|excluding|after|only (sophomores|juniors|upperclass))\b/i.test(raw),
      note: "read from wording; confirm",
    });
  const note = raw.trim();
  out.push(
    note.length <= 400
      ? { fieldKey: "club.eligibility_note", value: note }
      : { fieldKey: "club.eligibility_note", value: null, note: "too long; give --value" },
  );
  return out;
};

const parseInactive: ProposalParser = () =>
  // One report is a lead, not proof: propose "possibly dormant", never "inactive".
  one("club.activity_status", "possibly_dormant", "a single report; use --value=inactive only with evidence");

const parseNewName: ProposalParser = (raw) => {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 3 && name.length <= 200 ? one("club.name", name) : unread("club.name", "not a usable name");
};

const parseOldName: ProposalParser = (raw) => {
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 3 && name.length <= 200
    ? one("club.alias", { name, kind: "former" })
    : unread("club.alias", "not a usable name");
};

/** "hclubs.app/clubs/<slug>" or a bare slug → slug; else the text (a name to look up). */
export function duplicateTarget(raw: string): string {
  const t = raw.trim();
  return t.match(/\/clubs\/([a-z0-9-]+)/)?.[1] ?? t.match(/^\[?([a-z0-9]+(?:-[a-z0-9]+)+)\]?$/)?.[1] ?? t;
}

const parseDuplicate: ProposalParser = (raw) => [
  { fieldKey: "duplicate_of", value: duplicateTarget(raw), note: "accepting proposes a merge for review" },
];

const parseDescription: ProposalParser = (raw) => {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < 10) return unread("club.short_description", "too short");
  return t.length <= 400
    ? one("club.short_description", t, "the submitter's words; rewrite with --value if needed")
    : unread("club.short_description", "too long; give a summary with --value");
};

/** "Fall and spring", "every semester", "rolling" → seasons; null when none named. PURE. */
export function parseSeasons(raw: string): RecruitingSeason[] | null {
  // "We don't recruit in spring", "not in the fall": a season named only to rule it out.
  const t = raw
    .toLowerCase()
    .replace(/\b(?:no|not|never|don'?t|doesn'?t|do not|does not)\b[^.,;]*?\b(fall|spring|summer|winter)\b/g, " ");
  const out = new Set<RecruitingSeason>();
  if (/\b(every|each) semester\b|\bboth semesters\b/.test(t)) {
    out.add("fall");
    out.add("spring");
  }
  for (const s of ["fall", "spring", "summer", "winter"] as const) if (new RegExp(`\\b${s}\\b`).test(t)) out.add(s);
  if (/\b(rolling|any ?time|year[- ]round)\b/.test(t)) out.add("rolling");
  return out.size ? [...out].sort() : null;
}

const parseSeasonsAnswer: ProposalParser = (raw) => {
  const v = parseSeasons(raw);
  return v
    ? one("club.recruiting_seasons", v)
    : unread("club.recruiting_seasons", "no term named (fall, spring, rolling)");
};

const parseFirstYears: ProposalParser = (raw) => {
  // Only a bare yes or no: "not sure", "no restrictions", "not only first-years" are not answers.
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  if (/^(yes|y|yep|yeah|of course|absolutely)$/.test(t)) return one("club.freshmen_eligible", true);
  if (/^(no|n|nope)$/.test(t)) return one("club.freshmen_eligible", false);
  return unread("club.freshmen_eligible", "not a plain yes or no; read the answer");
};

// --- Types and their templates ---------------------------------------------------------------

const P = {
  website: { label: L.website, parse: parseWebsite },
  instagram: { label: L.instagram, hint: "link or @handle", parse: parseInstagram },
  applicationLink: { label: L.applicationLink, parse: parseApplicationLink },
  deadline: { label: L.deadline, hint: "date, and time if known", parse: parseDeadline },
  term: { label: L.term, hint: "e.g. Fall 2026", parse: null },
  howToJoin: {
    label: L.howToJoin,
    hint: "open, application, comp, audition, tryout or invite only",
    parse: parseJoin,
  },
  steps: { label: L.steps, hint: "e.g. application, then interview", parse: null },
  members: { label: L.members, hint: "about", parse: parseMembers },
  dues: { label: L.dues, hint: "amount and how often, or none", parse: parseDuesAnswer },
  memberHours: { label: L.memberHours, parse: hours("member") },
  compHours: { label: L.compHours, parse: hours("comp_period") },
  eligibility: { label: L.eligibility, hint: "e.g. all undergraduates; first-years welcome", parse: parseEligibility },
  inactive: { label: L.inactive, hint: "and since when", parse: parseInactive },
  newName: { label: L.newName, parse: parseNewName },
  oldName: { label: L.oldName, parse: parseOldName },
  duplicate: { label: L.duplicate, hint: "name or hclubs.app link", parse: parseDuplicate },
  does: { label: L.does, hint: "one or two sentences", parse: parseDescription },
  wrong: { label: L.wrong, parse: null },
  right: { label: L.right, parse: null },
  channel: { label: L.channel, hint: "so we can confirm", parse: null },
  update: { label: L.update, parse: null },
  clubName: { label: L.clubName, parse: null },
  anyLink: { label: L.anyLink, parse: parseAnyLink },
  firstYears: { label: L.firstYears, hint: "yes or no", parse: parseFirstYears },
  seasons: { label: L.seasons, hint: "fall, spring, both, or rolling", parse: parseSeasonsAnswer },
  shownAt: { label: L.shownAt, hint: "a page or post that says it", parse: null },
  notes: { label: L.notes, parse: null },
} satisfies Record<string, Prompt>;

export const CONTRIBUTION_TYPE_DEFS: readonly ContributionTypeDef[] = [
  {
    key: "missing_info",
    label: "Add missing club information",
    formOption: "Add missing info about a club",
    prompts: [P.does, P.website, P.instagram, P.howToJoin],
  },
  {
    key: "incorrect_info",
    label: "Something is wrong",
    formOption: "Fix something that's wrong",
    prompts: [P.wrong, P.right],
  },
  { key: "website", label: "Add or update website", formOption: "Website", prompts: [P.website] },
  {
    key: "instagram",
    label: "Add or update Instagram",
    formOption: "Instagram or other social account",
    prompts: [P.instagram],
  },
  {
    key: "deadline",
    label: "Recruiting deadline",
    formOption: "Recruiting deadline or dates",
    prompts: [P.deadline, P.term, P.applicationLink],
  },
  {
    key: "application_link",
    label: "Application link",
    formOption: "Application link",
    prompts: [P.applicationLink, P.term],
  },
  {
    key: "joining_process",
    label: "How to join",
    formOption: "How to join (comp, application, audition…)",
    prompts: [P.howToJoin, P.steps],
  },
  {
    key: "member_count",
    label: "Number of members",
    formOption: "Number of members",
    prompts: [P.members],
  },
  { key: "dues", label: "Dues", formOption: "Dues", prompts: [P.dues] },
  {
    key: "time_commitment",
    label: "Time commitment",
    formOption: "Time commitment",
    prompts: [P.memberHours, P.compHours],
  },
  { key: "eligibility", label: "Who can join", formOption: "Who can join", prompts: [P.eligibility] },
  { key: "inactive", label: "Club seems inactive", formOption: "Club is inactive", prompts: [P.inactive] },
  { key: "renamed", label: "Club was renamed", formOption: "Club was renamed", prompts: [P.newName, P.oldName] },
  { key: "duplicate", label: "Listed twice", formOption: "Club is listed twice", prompts: [P.duplicate] },
  {
    key: "missing_club",
    label: "A club that's missing",
    formOption: "A club that's missing from hclubs",
    prompts: [P.clubName, P.anyLink, P.does],
  },
  { key: "club_manager", label: "I run this club", formOption: OFFICER_FORM_OPTION, prompts: [P.channel, P.update] },
  { key: "other", label: "Something else", formOption: "Something else", prompts: [] },
];

const DEF_BY_KEY = new Map(CONTRIBUTION_TYPE_DEFS.map((d) => [d.key, d]));

export function contributionType(key: ContributionType): ContributionTypeDef {
  const d = DEF_BY_KEY.get(key);
  if (!d) throw new Error(`unknown contribution type: ${key}`);
  return d;
}

/** Prefilled answer for the form's Details question: one "Label: " line per prompt. PURE. */
export function contributionTemplate(key: ContributionType): string {
  const d = contributionType(key);
  return d.prompts.map((p) => `${p.label}${"hint" in p && p.hint ? ` (${p.hint})` : ""}: `).join("\n");
}

const normLabel = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ALL_PROMPTS: Prompt[] = [...new Map(Object.values(P).map((p) => [normLabel(p.label), p as Prompt])).values()];
const PROMPT_BY_LABEL = new Map(ALL_PROMPTS.map((p) => [normLabel(p.label), p]));

/**
 * Split a Details answer into template answers (label → text, continuation lines appended)
 * and free text. Labels are matched without their hint, so "Instagram (link): @x" and
 * "instagram: @x" both count. PURE.
 */
export function readTemplateAnswers(details: string): { answers: Map<string, string>; freeText: string } {
  const answers = new Map<string, string>();
  const free: string[] = [];
  let current: string | null = null;
  for (const line of details.split(/\r?\n/)) {
    const m = line.match(/^\s*([^:]{2,80}?)\s*:\s*(.*)$/);
    const label = m ? normLabel(m[1] ?? "") : null;
    if (label && PROMPT_BY_LABEL.has(label)) {
      current = label;
      answers.set(label, (m?.[2] ?? "").trim());
    } else if (current && answers.get(current) && line.trim()) {
      // Only an answer already begun continues; text after an unanswered line is free text.
      answers.set(current, `${answers.get(current) ?? ""}\n${line.trim()}`.trim());
    } else if (line.trim()) {
      current = null;
      free.push(line.trim());
    }
  }
  for (const [k, v] of answers) if (!v) answers.delete(k);
  return { answers, freeText: free.join("\n") };
}

/**
 * The link a submitter gave on the "Where this is posted" line (the site's suggest form
 * puts it there because the form's own source question can't be prefilled), or null. PURE.
 */
export function postedLink(details: string): string | null {
  const v = readTemplateAnswers(details).answers.get(normLabel(L.shownAt))?.trim() ?? "";
  return /^https?:\/\/\S+$/i.test(v) ? v.slice(0, 500) : null;
}

/** A contribution type as the site's suggest form needs it: plain data, safe to serialize. */
export interface ContributionTopic {
  key: ContributionType;
  label: string;
  formOption: string;
  prompts: { label: string; hint: string | null }[];
}

export function contributionTopic(key: ContributionType): ContributionTopic {
  const d = contributionType(key);
  return {
    key: d.key,
    label: d.label,
    formOption: d.formOption,
    prompts: d.prompts.map((p) => ({ label: p.label, hint: p.hint ?? null })),
  };
}

/** Proposed field values from a Details answer. Unanswered lines propose nothing. PURE. */
export function parseProposals(details: string, opts: { submittedAt: Date }): ProposedField[] {
  const { answers } = readTemplateAnswers(details);
  const ctx: ParseContext = { submittedAt: opts.submittedAt, answers };
  const out: ProposedField[] = [];
  for (const [label, raw] of answers) {
    const prompt = PROMPT_BY_LABEL.get(label);
    if (!prompt?.parse) continue;
    for (const p of prompt.parse(raw, ctx)) out.push({ label: prompt.label, raw, ...p });
  }
  return out;
}

/** The type a "What kind of update?" answer names, or null for a generic answer. PURE. */
function typeFromFormAnswer(formAnswer: string): ContributionType | null {
  const f = formAnswer.toLowerCase();
  // Answers the previous form used for several kinds at once: the details decide.
  if (/^(other|website or social link|how to join \/ comp process|recruiting deadline or dates)$/.test(f.trim()))
    return null;
  if (/missing from hclubs/.test(f)) return "missing_club";
  if (/add missing info/.test(f)) return "missing_info";
  if (/something that's wrong|fix something/.test(f)) return "incorrect_info";
  if (/application link/.test(f)) return "application_link";
  if (/deadline|recruit|dates/.test(f)) return "deadline";
  if (/how to join|comp process/.test(f)) return "joining_process";
  if (/who can join|eligib/.test(f)) return "eligibility";
  if (/time commitment|hours/.test(f)) return "time_commitment";
  if (/number of members|size|members/.test(f)) return "member_count";
  if (/dues/.test(f)) return "dues";
  if (/instagram|social account/.test(f)) return "instagram";
  if (/website|link/.test(f)) return "website";
  if (/inactive|dormant/.test(f)) return "inactive";
  if (/renamed/.test(f)) return "renamed";
  if (/listed twice|duplicate/.test(f)) return "duplicate";
  if (/run this club/.test(f)) return "club_manager";
  if (/feedback about the site/.test(f)) return "other";
  return null;
}

/** The type whose template lines the answer filled in best, or null. PURE. */
function typeFromTemplate(details: string): ContributionType | null {
  const labels = [...readTemplateAnswers(details).answers.keys()];
  let best: ContributionTypeDef | null = null;
  let bestScore = 0;
  for (const d of CONTRIBUTION_TYPE_DEFS) {
    const own = new Set(d.prompts.map((p) => normLabel(p.label)));
    const hit = labels.filter((l) => own.has(l)).length;
    const score = hit - (own.size - hit) * 0.01;
    if (hit && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best?.key ?? null;
}

/**
 * The contribution type of a response: the form's "What kind of update?" answer when it
 * names one kind, else the template lines the submitter filled in (old generic answers
 * like "Other", or "Something else"). PURE.
 */
export function contributionTypeOf(formAnswer: string, details: string): ContributionType {
  return typeFromFormAnswer(formAnswer) ?? typeFromTemplate(details) ?? "other";
}

// --- Privacy -----------------------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w/])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w/])/g;

/**
 * Remove email addresses and phone numbers from submitted text before it is stored
 * (§21: no personal contact details). Returns how many were removed. PURE.
 */
export function redactContactDetails(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text
    .replace(EMAIL, () => {
      removed++;
      return "[email removed]";
    })
    .replace(PHONE, () => {
      removed++;
      return "[phone removed]";
    });
  return { text: out, removed };
}
