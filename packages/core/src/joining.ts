import { classEligibility } from "./eligibility";
import { experienceValueScoped, statesNoExperience } from "./experience";
import type { JoinMode } from "./enum-values";
import type { ResolvedValue, SourceRef } from "./resolve/resolver";

/**
 * Joining facts derived from sourced claims (ADR 0041). PURE, deterministic, versioned.
 *
 * Claims stay atomic ("club.join_mode = audition", with its quote); this module draws the
 * conservative conclusions a student needs, each with the claims and pages it rests on:
 *
 *  - which processes apply to GENERAL membership, and which only to some roles (a board,
 *    a competition team, a conductor's seat), so an open club with a selective board isn't
 *    filed as selective;
 *  - `access`: open (a source says anyone can join, or membership comes from showing up),
 *    process (an application, comp, audition, tryout or invitation), mixed (sources say
 *    both), or unknown. Process type ≠ selectivity (CLAUDE.md §9): `process` never claims
 *    that anyone is turned away;
 *  - `noCuts`: the comp is stated to admit everyone who completes it;
 *  - `comp`, `firstYears`, `dues`: yes / no / unknown. Unknown is never "no": a club with
 *    no evidence lands in neither the positive nor the negative bucket;
 *  - `noExperience`: yes / unknown only (joining-v2, ADR 0042): a verbatim quote states that
 *    joining needs no prior experience. A requirement is never derived.
 *
 * Where credible sources disagree the value is unknown and the key is listed in
 * `conflicts`, except that a specific class-year rule ("first apply in your sophomore
 * year") beats a generic population ("any undergraduate may apply"); the generic one is
 * kept as `contrary` evidence so the profile can show both.
 */
export const JOINING_VERSION = "joining-v2";

export const JOIN_ROLES = ["leadership", "team", "ensemble", "fund"] as const;
export type JoinRole = (typeof JOIN_ROLES)[number];

export const JOIN_ROLE_LABEL: Record<JoinRole, string> = {
  leadership: "board and leadership roles",
  team: "competition teams",
  ensemble: "performing roles",
  fund: "running the club's fund",
};

export type JoiningAccess = "open" | "process" | "mixed";
export type JoiningKey = "access" | "comp" | "noCuts" | "firstYears" | "dues" | "noExperience";

/** Why a derived value holds. Shown on the profile in plain words (`JOINING_RULE_TEXT`). */
export const JOINING_RULES = [
  "stated_open",
  "stated_process",
  "sources_differ",
  "college_directory_no_comp",
  "stated_comp",
  "open_membership",
  "completion_based",
  "first_years_named",
  "first_years_excluded",
  "class_list",
  "open_population",
  "stated_dues",
  "stated_no_experience",
] as const;
export type JoiningRule = (typeof JOINING_RULES)[number];

export const JOINING_RULE_TEXT: Record<JoiningRule, string> = {
  stated_open: "A source says anyone can join, or that membership comes from showing up.",
  stated_process: "A source describes this process for new members.",
  sources_differ: "Sources disagree, so we don't pick one.",
  college_directory_no_comp: "The College's student-organization directory lists no comping requirement.",
  stated_comp: "A source describes a comp for new members.",
  open_membership: "A source says anyone can join, so there's no comp for general membership.",
  completion_based: "A source says everyone who completes the comp (or audition) becomes a member — no cuts.",
  first_years_named: "A source names first-years among who can join.",
  first_years_excluded: "A source says first-years can't join yet (for example, that you first apply as a sophomore).",
  class_list: "A source lists the class years that can join, and first-years aren't among them.",
  open_population: "A source opens membership to all Harvard undergraduates (or everyone), which includes first-years.",
  stated_dues: "From the source's statement about dues.",
  stated_no_experience: "A source says you don't need prior experience to join.",
};

/** A page behind a derived value (no quote: quotes stay internal, launch audit). */
export interface BasisSource {
  url: string;
  title: string | null;
  sourceType: SourceRef["sourceType"];
  observedAt: string;
  isFixture: boolean;
}

export interface JoiningBasis {
  rule: JoiningRule;
  claimIds: string[];
  sources: BasisSource[];
  /** Evidence pointing the other way that a more specific statement outweighed. */
  contrary?: { claimIds: string[]; sources: BasisSource[] };
}

export interface Joining {
  version: typeof JOINING_VERSION;
  access: JoiningAccess | null;
  /** How general members join (role-only processes excluded), in a stable order. */
  general: JoinMode[];
  /** Processes stated only for some roles. */
  roles: { mode: JoinMode; role: JoinRole }[];
  noCuts: boolean;
  /** true: a comp for general membership; false: no comp (directory flag or open membership). */
  comp: boolean | null;
  firstYears: boolean | null;
  /** true: dues are charged; false: a source says none. */
  dues: boolean | null;
  /** true: a source says no prior experience is needed; never false (requirements aren't derived). */
  noExperience: true | null;
  conflicts: JoiningKey[];
  basis: Partial<Record<JoiningKey, JoiningBasis>>;
}

export interface JoiningInput {
  /** Every accepted `club.join_mode` value (multi field). */
  joinModes: readonly ResolvedValue<unknown>[];
  /** Every accepted value (not only the displayed one) of these single fields. */
  freshmenEligible: readonly ResolvedValue<unknown>[];
  eligibleClasses: readonly ResolvedValue<unknown>[];
  /** `cycle.eligible_classes` values of the club's recruiting cycles. */
  cycleEligibleClasses: readonly ResolvedValue<unknown>[];
  /** The resolved `club.dues` field. */
  dues: { current: ResolvedValue<unknown> | null; conflict: boolean } | null;
  /** Accepted `club.tag` values (the College directory's flags arrive as tags). */
  tags: readonly ResolvedValue<unknown>[];
  /** Every accepted `club.experience_required` value; read through its verbatim quotes only. */
  experienceRequired?: readonly ResolvedValue<unknown>[];
}

const MODE_ORDER: JoinMode[] = ["open", "attendance_based", "application", "comp", "audition", "tryout", "invite_only"];
const OPEN_MODES = new Set<JoinMode>(["open", "attendance_based"]);
const isJoinMode = (v: unknown): v is JoinMode => typeof v === "string" && (MODE_ORDER as string[]).includes(v);

/** Roles that aren't general membership. Order matters: the first match names the role. */
const ROLE_PATTERNS: [JoinRole, RegExp][] = [
  [
    "leadership",
    // Publications call their staff sections "boards" ("prospective board members can join
    // Crimson Business"), so a bare "board member" is membership, not a leadership role.
    /\b(?:e-?board|exec(?:utive)? (?:board|team|committee|staff|positions?|roles?)|board (?:positions?|roles?|seats?)|on (?:our|the|its) (?:executive |leadership )?board\b|join (?:our|the|its|[a-z]{2,6}) (?:executive |leadership )?board\b|apply (?:to be |for )(?:a |an |the |one of (?:our|the) )?(?:[\w-]+ ){0,2}(?:directors?|chairs?|officers?|president|treasurer|secretary|representatives?|reps?|ambassadors?)\b|(?:officer|director|chair|leadership|management|staff) (?:positions?|roles?)|leadership team|(?:frosh|freshman|first-year|house) (?:reps?|representatives?)\b|ambassadors?\b|committees?\b[^.!?]{0,30}\bapplication|\bapplications?\b[^.!?]{0,30}\bcommittees?\b|\bapply (?:to|for) (?:a |our |the )?committees?\b)/i,
  ],
  [
    "team",
    /\b(?:competition|competitive|travel(?:l?ing)?|case|varsity|tournament|a[- ]team|b[- ]team) (?:teams?|squads?|rosters?)\b|\bcaptains?\b/i,
  ],
  [
    "ensemble",
    /\b(?:conductors?|soloists?|section leaders?|concertmasters?|schola|sub-?groups?|sub-?ensembles?|acting roles?|(?:roles|parts) (?:are|is) cast|cast(?:ing)? (?:for|of) (?:each|every|the|our) (?:show|production)s?)\b/i,
  ],
  ["fund", /\bmanag(?:e|es|ing) (?:the |our |a |[A-Z]{2,5}[’']s )?(?:\$[\d,]+ )?(?:[\w-]+ ){0,3}(?:fund|portfolio)\b/i],
];

/** Words that make a quote about joining the club itself, whatever else it mentions. */
const GENERAL_JOIN =
  /\b(?:join(?:ing)? (?:us|the (?:club|group|team|organization|society|community)|our (?:club|group|community|organization|society))|become (?:a )?(?:general |new )?members?|general (?:body|members?|membership)|new members)\b/i;
/** "join HUSL", but not "Join HUMA Board". Case-sensitive: acronyms only. */
const GENERAL_JOIN_ACRONYM = /\b[Jj]oin(?:ing)? [A-Z]{2,6}\b(?!\s+(?:[Bb]oard|[Ee]xec|[Ll]eadership))/;

/**
 * Whether a quote behind a selective join mode is about general membership or one role.
 * A quote with no text (an editorial or student-reported claim) is general. PURE.
 */
/** The board as reviewer, not a role: "reviewed by the executive board", "our Executive Board selects". */
const BOARD_AS_REVIEWER =
  /\b(?:by|with)\s+(?:members of\s+)?(?:the|our|its)\s+(?:[\w-]+\s+){0,2}?(?:executive\s+)?board\b|\b(?:the|our|its)\s+(?:executive\s+)?board\s+(?:selects|chooses|reviews|interviews|reads|picks)\b/gi;

export function joinQuoteScope(quote: string | null): { scope: "general" } | { scope: "role"; role: JoinRole } {
  if (!quote) return { scope: "general" };
  const q = quote.replace(/\s+/g, " ").replace(BOARD_AS_REVIEWER, " ");
  if (GENERAL_JOIN.test(q) || GENERAL_JOIN_ACRONYM.test(q)) return { scope: "general" };
  for (const [role, re] of ROLE_PATTERNS) if (re.test(q)) return { scope: "role", role };
  return { scope: "general" };
}

const NO_CUTS =
  /\b(?:completion[- ]based|no[- ]cuts?|non-?cut|do(?:es)? not cut|don['’]t cut|never cut|no one is cut|nobody is cut|everyone who completes|all (?:compers|students|members|participants) who complete)\b/i;
const NOT_NO_CUTS = /\bnot (?:a )?(?:completion[- ]based|no[- ]cut)\b/i;
/**
 * An "open" quote that is about the process itself: "There's no need to sweat our auditions —
 * anyone who wants to join the Band can join." The process admits everyone; it isn't a
 * second, contradicting way in (joining-v2).
 */
const PROCESS_WORD: Partial<Record<JoinMode, RegExp>> = {
  comp: /\bcomp(?:s|ing)?\b/i,
  audition: /\baudition(?:s|ing)?\b/i,
  tryout: /\btry-?outs?\b/i,
};
const EVERYONE_JOINS =
  /\b(?:anyone|everyone|anybody|all students?) who (?:wants?|would like) to join\b[^.!?]{0,40}\bcan join\b|\beveryone (?:who (?:tries out|auditions|comps) )?(?:gets in|makes it|is accepted|is admitted)\b/i;

const toBasisSource = (s: SourceRef): BasisSource => ({
  url: s.url,
  title: s.title,
  sourceType: s.sourceType,
  observedAt: s.observedAt,
  isFixture: s.isFixture,
});

/** Sources of several values, one per page, most recent first. */
function basisOf(rule: JoiningRule, values: readonly ResolvedValue<unknown>[]): JoiningBasis {
  const seen = new Set<string>();
  const sources: BasisSource[] = [];
  for (const s of values.flatMap((v) => v.sources).sort((a, b) => b.observedAt.localeCompare(a.observedAt))) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    sources.push(toBasisSource(s));
  }
  return { rule, claimIds: [...new Set(values.map((v) => v.claimId))].sort(), sources };
}

const quotes = (v: ResolvedValue<unknown>): (string | null)[] =>
  v.sources.length ? v.sources.map((s) => s.quote) : [null];

interface FirstYearEvidence {
  value: boolean;
  /** 3: names first-years or lists class years; 2: a population that includes them. */
  strength: 2 | 3;
  rule: JoiningRule;
  v: ResolvedValue<unknown>;
}

/** What one accepted class-year list says about first-years. */
function fromClassList(v: ResolvedValue<unknown>): FirstYearEvidence | null {
  const list = Array.isArray(v.value) ? (v.value as string[]) : [];
  const parsed = quotes(v)
    .map((q) => (q ? classEligibility(q) : null))
    .find((p) => p !== null);
  if (list.includes("first_year")) {
    // A list derived from "all undergraduates" is a population; one naming first-years is explicit.
    const named = parsed?.kind === "explicit";
    return { value: true, strength: named ? 3 : 2, rule: named ? "first_years_named" : "open_population", v };
  }
  // A list without first-years restricts only when worded as a restriction (not "typically").
  if (parsed?.firstYears === false) return { value: false, strength: 3, rule: "class_list", v };
  return null;
}

export function deriveJoining(input: JoiningInput): Joining {
  const basis: Joining["basis"] = {};
  const conflicts: JoiningKey[] = [];

  // --- How members join --------------------------------------------------------------------
  const general = new Map<JoinMode, ResolvedValue<unknown>>();
  const roles = new Map<string, { mode: JoinMode; role: JoinRole }>();
  const generalQuotes: { mode: JoinMode; quote: string | null; v: ResolvedValue<unknown> }[] = [];
  for (const v of input.joinModes) {
    if (!isJoinMode(v.value)) continue;
    const mode = v.value;
    if (OPEN_MODES.has(mode)) {
      general.set(mode, v);
      for (const q of quotes(v)) generalQuotes.push({ mode, quote: q, v });
      continue;
    }
    const scopes = quotes(v).map((q) => ({ q, s: joinQuoteScope(q) }));
    const gen = scopes.filter((x) => x.s.scope === "general");
    if (gen.length) {
      general.set(mode, v);
      for (const x of gen) generalQuotes.push({ mode, quote: x.q, v });
    } else {
      const first = scopes[0]?.s;
      if (first?.scope === "role") roles.set(`${mode}|${first.role}`, { mode, role: first.role });
    }
  }
  const generalModes = MODE_ORDER.filter((m) => general.has(m));
  const openVals = generalModes.filter((m) => OPEN_MODES.has(m)).map((m) => general.get(m)!);
  const processVals = generalModes.filter((m) => !OPEN_MODES.has(m)).map((m) => general.get(m)!);

  let access: JoiningAccess | null = null;
  if (openVals.length && !processVals.length) {
    access = "open";
    basis.access = basisOf("stated_open", openVals);
  } else if (processVals.length && !openVals.length) {
    access = "process";
    basis.access = basisOf("stated_process", processVals);
  } else if (
    openVals.length &&
    processVals.length === 1 &&
    openVals.some((v) =>
      quotes(v).some(
        (q) =>
          q !== null && EVERYONE_JOINS.test(q) && (PROCESS_WORD[processVals[0]!.value as JoinMode]?.test(q) ?? false),
      ),
    )
  ) {
    // The open quote explains the one process: everyone who goes through it gets in.
    access = "process";
    basis.access = basisOf("stated_process", processVals);
  } else if (openVals.length && processVals.length) {
    access = "mixed";
    conflicts.push("access");
    basis.access = basisOf("sources_differ", [...openVals, ...processVals]);
  }

  // One comp, audition or tryout that admits everyone who completes it ("completion-based
  // comp", "our auditions are no-cuts"), with no other process for members.
  const compVal = general.get("comp");
  const only = processVals.length === 1 ? processVals[0] : undefined;
  const explained = access === "process" && openVals.length > 0;
  const noCuts =
    only !== undefined &&
    ["comp", "audition", "tryout"].includes(only.value as string) &&
    (explained || quotes(only).some((q) => q !== null && NO_CUTS.test(q) && !NOT_NO_CUTS.test(q)));
  if (noCuts && only) basis.noCuts = basisOf("completion_based", explained ? [only, ...openVals] : [only]);

  // --- Comp ----------------------------------------------------------------------------------
  const directoryNoComp = input.tags.filter(
    (t) => typeof t.value === "string" && /^no comping requirement$/i.test(t.value.trim()),
  );
  let comp: boolean | null = null;
  const compNo = [...directoryNoComp, ...(access === "open" ? openVals : [])];
  if (compVal && compNo.length) {
    conflicts.push("comp");
    basis.comp = basisOf("sources_differ", [compVal, ...compNo]);
  } else if (compVal) {
    comp = true;
    basis.comp = basisOf("stated_comp", [compVal]);
  } else if (directoryNoComp.length) {
    comp = false;
    basis.comp = basisOf("college_directory_no_comp", directoryNoComp);
  } else if (access === "open") {
    comp = false;
    basis.comp = basisOf("open_membership", openVals);
  }

  // --- First-years ---------------------------------------------------------------------------
  const evidence: FirstYearEvidence[] = [];
  for (const v of input.freshmenEligible)
    if (typeof v.value === "boolean")
      evidence.push({ value: v.value, strength: 3, rule: v.value ? "first_years_named" : "first_years_excluded", v });
  for (const v of [...input.eligibleClasses, ...input.cycleEligibleClasses]) {
    const e = fromClassList(v);
    if (e) evidence.push(e);
  }
  for (const g of generalQuotes) {
    if (!g.quote) continue;
    const p = classEligibility(g.quote, "membership");
    if (!p || p.firstYears === null) continue;
    evidence.push({
      value: p.firstYears,
      strength: p.kind === "population" ? 2 : 3,
      rule:
        p.kind === "population"
          ? "open_population"
          : p.kind === "list"
            ? "class_list"
            : p.firstYears
              ? "first_years_named"
              : "first_years_excluded",
      v: g.v,
    });
  }
  let firstYears: boolean | null = null;
  const yes = evidence.filter((e) => e.value);
  const no = evidence.filter((e) => !e.value);
  const top = (list: FirstYearEvidence[]) => Math.max(0, ...list.map((e) => e.strength));
  const strongest = (list: FirstYearEvidence[]) => list.filter((e) => e.strength === top(list));
  if (yes.length && no.length && top(yes) === top(no)) {
    conflicts.push("firstYears");
    basis.firstYears = basisOf(
      "sources_differ",
      [...strongest(yes), ...strongest(no)].map((e) => e.v),
    );
  } else if (yes.length || no.length) {
    const win = top(yes) > top(no) ? yes : no;
    const lose = win === yes ? no : yes;
    firstYears = win === yes;
    const best = strongest(win);
    basis.firstYears = basisOf(
      best[0]!.rule,
      best.map((e) => e.v),
    );
    if (lose.length) {
      const c = basisOf(
        lose[0]!.rule,
        lose.map((e) => e.v),
      );
      basis.firstYears.contrary = { claimIds: c.claimIds, sources: c.sources };
    }
  }

  // --- Dues ----------------------------------------------------------------------------------
  let dues: boolean | null = null;
  const duesVal = input.dues?.current ?? null;
  const hasDues =
    duesVal && duesVal.value && typeof duesVal.value === "object"
      ? (duesVal.value as { hasDues?: unknown }).hasDues
      : null;
  if (duesVal && typeof hasDues === "boolean") {
    if (input.dues?.conflict) {
      conflicts.push("dues");
      basis.dues = basisOf("sources_differ", [duesVal]);
    } else {
      dues = hasDues;
      basis.dues = basisOf("stated_dues", [duesVal]);
    }
  }

  // --- Prior experience ----------------------------------------------------------------------
  const noExpVals = (input.experienceRequired ?? []).filter(
    (v) => !experienceValueScoped(v.value) && v.sources.some((s) => statesNoExperience(s.quote)),
  );
  const noExperience: true | null = noExpVals.length ? true : null;
  if (noExperience) basis.noExperience = basisOf("stated_no_experience", noExpVals);

  return {
    version: JOINING_VERSION,
    access,
    general: generalModes,
    roles: [...roles.values()].sort(
      (a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) || a.role.localeCompare(b.role),
    ),
    noCuts,
    comp,
    firstYears,
    dues,
    noExperience,
    conflicts,
    basis,
  };
}

/** The empty assessment: nothing known. */
export const UNKNOWN_JOINING: Joining = {
  version: JOINING_VERSION,
  access: null,
  general: [],
  roles: [],
  noCuts: false,
  comp: null,
  firstYears: null,
  dues: null,
  noExperience: null,
  conflicts: [],
  basis: {},
};
