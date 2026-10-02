import { classEligibility } from "@hci/core";
/**
 * What a verbatim quote can and cannot support, for the fields most prone to misreading:
 * member counts, hours per week, dues, "open" membership and stated weekdays. PURE.
 *
 * One rule set, used three ways: the deterministic extractor and the LLM grounding step
 * refuse a claim whose quote fails, and the data-quality audit (ADR 0033) rejects existing
 * claims that fail. Each function returns null when the quote supports the value, or the
 * reason it doesn't.
 */

export interface QuoteProblem {
  check: string;
  why: string;
}

const NUMBER_WORDS: Record<number, string> = Object.fromEntries(
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
    .split(" ")
    .map((w, i) => [i, w] as const)
    .concat([
      [30, "thirty"],
      [40, "forty"],
      [50, "fifty"],
      [60, "sixty"],
      [100, "hundred"],
    ]),
);

/** Whether `n` appears in the quote ("1,200" and "1200" both count; small numbers as words). */
export function numberAppears(n: number, quote: string): boolean {
  const q = quote.replace(/(\d),(\d{3})/g, "$1$2");
  if (new RegExp(`(^|[^\\d.])${String(n).replace(".", "\\.")}([^\\d]|$)`).test(q)) return true;
  const w = NUMBER_WORDS[n];
  return Boolean(w && new RegExp(`\\b${w}\\b`, "i").test(quote));
}

/** The text just before and after the first occurrence of `n` in `quote`. */
function around(quote: string, n: number): { before: string; after: string } | null {
  const q = quote.replace(/(\d),(\d{3})/g, "$1$2");
  const m = new RegExp(`(^|[^\\d.])(${String(n)})(?![\\d])`).exec(q);
  if (!m) return null;
  const at = m.index + (m[1]?.length ?? 0);
  const end = at + String(n).length;
  return { before: q.slice(Math.max(0, at - 70), at), after: q.slice(end, end + 80) };
}

// --- Member counts ---------------------------------------------------------------------------

/** A people noun within the rest of the number's clause ("250+ Harvard College students"). */
const MEMBER_NOUN_NEAR =
  /^[^.;]{0,70}?\b(members?|membership|students|undergraduates|singers|dancers|voices?|players|musicians|athletes|participants|people|volunteers|staff|writers|editors|women|men|individuals|scholars|engineers|leaders)\b|^-voice\b/i;
/** What the number counts, judged from the words just before and after it. */
const NOT_MEMBERSHIP: { before?: RegExp; after?: RegExp; why: string }[] = [
  { before: /(mailing lists?|email lists?|listserv|newsletter)\b[^.]*$/i, why: "counts a mailing list" },
  { after: /^[\s+]*(followers?|following|subscribers?)\b/i, why: "counts followers" },
  { before: /\b(alumni|alumnae|graduates join|former members|network of)\b[^.]*$/i, why: "counts alumni or a network" },
  { after: /^[\s+]*(alumni|alumnae)\b/i, why: "counts alumni" },
  // "more than 6,400 global members": a worldwide network of alumni and professionals.
  {
    after: /^[\s+,]*(global|worldwide|international|network|community)\s+(members?|membership|community)\b/i,
    why: "counts a worldwide network, not the student membership",
  },
  { after: /^[\s+]*(employees|staffers)\b/i, why: "counts employees" },
  {
    after:
      /^[^.]{0,60}\b(gathered|attended|attendees|turnout|audience|spectators|guests|delegates|competitors|hackers)\b/i,
    why: "counts event attendance",
  },
  { before: /\b(attendees|delegates|competitors|hackers|audience of)\b[^.]{0,20}$/i, why: "counts event attendance" },
  { before: /\b(petition|signed by|quorum|at least)\b[^.]{0,30}$/i, why: "a bylaws threshold, not a membership count" },
  { before: /\b(board|committee)( of| consists of[^.]{0,30})\s*$/i, why: "counts a board, not the membership" },
  { before: /\b(board|committee) of \d+\s*[-–]\s*$/i, why: "counts a board, not the membership" },
  { before: /\b(partners|sponsors)\b[^.]{0,40}$/i, why: "counts partners or sponsors" },
  {
    after: /^[\s+]*(partners|sponsors|clients|projects|chapters|countries|schools|teams|events)\b/i,
    why: "counts something other than members",
  },
  { after: /^[^.]{0,40}\bpast\b[^.]{0,40}\bprogram\b/i, why: "counts past program participants" },
];

/** Whether `quote` supports a member count of `nums` (exact count, or range bounds). */
export function memberCountProblem(quote: string, nums: readonly number[]): QuoteProblem | null {
  if (!nums.length) return null;
  if (!nums.every((n) => numberAppears(n, quote)))
    return { check: "number_not_in_quote", why: `${nums.join("–")} does not appear in the quoted text` };
  const n = Math.max(...nums);
  // "generally with 40-50 members" read as exactly 50 (ADR 0040).
  if (nums.length === 1 && new RegExp(`\\b\\d+\\s*(?:-|–|to)\\s*${n}\\b|\\b${n}\\s*(?:-|–|to)\\s*\\d+\\b`).test(quote))
    return {
      check: "member_count_range_read_as_one",
      why: `the quote gives a range, not ${n}: "${quote.slice(0, 90)}"`,
    };
  const w = around(quote, n);
  if (!w) return null; // written out in words; nothing more to judge
  const snippet = `"…${w.before.slice(-40)}${n}${w.after.slice(0, 40)}…"`;
  for (const rule of NOT_MEMBERSHIP)
    if ((rule.before?.test(w.before) ?? false) || (rule.after?.test(w.after) ?? false))
      return { check: "member_count_not_membership", why: `${rule.why}: ${snippet}` };
  if (
    !MEMBER_NOUN_NEAR.test(w.after.split(/[.;!?]/)[0] ?? "") &&
    !/\b(members?|membership)\b[^.]{0,25}$/i.test(w.before)
  )
    return { check: "member_count_unit_unclear", why: `the quote never says what ${n} counts: ${snippet}` };
  return null;
}

// --- Hours per week ----------------------------------------------------------------------------

/** A job or role listing, not a club's time commitment. */
export const JOB_LISTING =
  /\b(position|role|job|salary|salaried|permanent|full-time|part-time|paid|employment|hire|hiring|intern(ship)?|eligible for this)\b/i;
/** More hours than any club commitment: a job. */
export const MAX_CLUB_HOURS = 30;

export function hoursProblem(quote: string, nums: readonly number[]): QuoteProblem | null {
  if (nums.length && !nums.every((n) => numberAppears(n, quote)))
    return { check: "number_not_in_quote", why: `${nums.join("–")} h/week does not appear in the quote` };
  if (Math.max(...nums, 0) > MAX_CLUB_HOURS)
    return { check: "hours_implausible", why: `${Math.max(...nums)} hours/week is a job, not a club commitment` };
  const job = quote.match(JOB_LISTING)?.[0];
  if (job) return { check: "hours_from_job_posting", why: `from a job/role listing: "${job}"` };
  return null;
}

// --- Dues ---------------------------------------------------------------------------------------

/** Words that make a sentence about membership dues. */
const DUES_WORDS =
  /\b(dues|membership fees?|member fees?|annual fee|semester(ly)? fee|fee to join|cost to join|costs? nothing to join|free to join|no (membership )?(fees?|dues|cost))\b/i;
const JOIN_WORDS = /\b(join|joining|membership|members?)\b/i;
/** Prices and "free" that are about something else: tickets, ice time, an event, a program. */
const NOT_DUES =
  /\b(tickets?|admission|entry fee|registration|ice|rink|buy-?ins?|equity|hackers|attendees|practices? (are|is) free|free practices|trial)\b/i;

export function duesProblem(quote: string, amountUsd: number | null | undefined): QuoteProblem | null {
  const about = DUES_WORDS.test(quote) || (/\bfree\b/i.test(quote) && JOIN_WORDS.test(quote));
  if (!about || (NOT_DUES.test(quote) && !/\bdues\b/i.test(quote)))
    return {
      check: "dues_not_about_membership",
      why: `the quote is not about membership dues: "${quote.slice(0, 80)}"`,
    };
  if (typeof amountUsd === "number" && !numberAppears(amountUsd, quote))
    return { check: "number_not_in_quote", why: `$${amountUsd} does not appear in the quote` };
  return null;
}

// --- "Open" membership -----------------------------------------------------------------------------

/** "Open to all" said about an event is not open membership. */
const OPEN_ABOUT_EVENT =
  /\b(events?|socials?|clinic|competitions?|workshops?|sessions?|talks?|lectures?|games?|treats|meetings? (are|is) open|rehearsals?|concerts?|shows?|initiative|conference|tournament)\b[^.!?]{0,80}\b(open to|welcome)\b|\b(open to|welcome)\b[^.!?]{0,40}\b(attend|observe|events?)\b/i;
/** …nor is "auditions are open to all": that is a selective process anyone may enter. */
const OPEN_ABOUT_PROCESS =
  /\b(auditions?|tryouts?|comps?|applications?)\b[^.!?]{0,40}\b(are |is )?open\b|\bopen and completion|\b(welcome|invited|encouraged|free) to (audition|try ?out|apply|comp)\b|\b(anyone|everyone) (can|may|is welcome to) (audition|apply|try ?out)\b/i;
/** "Free & open to all", "Registration required": an event listing. */
const EVENT_LISTING =
  /\bfree (and|&) open\b|\bregistration required\b|\brsvp\b|\b(?:sweet )?treats\b|\bsnacks\b|\brefreshments\b|\bpizza\b|\bcake\b|\bfood (?:will be|is) (?:provided|served)\b/i;
/** A membership word in an event sentence; "regardless of membership status" is not one. */
const JOIN_IN_EVENT = /\b(join|no comp|no application)\b|\bmembership\b(?! status)/i;
const NO_PROCESS = /\bno (comp|application|audition|tryout)s?\b|\bwithout (an? )?(comp|application|audition)/i;
const MEMBERSHIP_SIGNAL =
  /\b(join|joining|member(ship|s)?|no (comp|application|audition|tryout)s?|without (an )?(audition|application)|open to (all|any(one|body)?|every(one|body)?)|anyone (can|is welcome|who wants)|all are welcome|everyone is welcome|no experience|just show up|accept (any|all|every)\w*)\b|\ball\b[^.!?]{0,60}\bare welcome\b/i;

export function openMembershipProblem(quote: string): QuoteProblem | null {
  if (OPEN_ABOUT_PROCESS.test(quote) && !NO_PROCESS.test(quote))
    return {
      check: "open_from_process",
      why: `"open" refers to an audition/comp/application: "${quote.slice(0, 90)}"`,
    };
  if ((OPEN_ABOUT_EVENT.test(quote) || EVENT_LISTING.test(quote)) && !JOIN_IN_EVENT.test(quote))
    return { check: "open_from_event", why: `"open" refers to an event: "${quote.slice(0, 90)}"` };
  if (!MEMBERSHIP_SIGNAL.test(quote))
    return { check: "open_unsupported", why: `the quote says nothing about joining: "${quote.slice(0, 90)}"` };
  return null;
}

/**
 * Says outright that joining involves no selection: "no comp process or application",
 * "no tryouts, no cuts", "anyone who wants to join can join", "can be a member", "just show
 * up". "Open to all Harvard College undergraduates" is not enough on its own: clubs with a
 * comp or audition say it too, about who may apply (see the audit's
 * `join.open_beside_process`). PURE.
 */
const EXPLICIT_OPEN =
  /\bno ["“'‘]?(formal )?(comp|application|audition|tryout|cut)(s|["”'’])*( process| required)?\b|\bnon-?audition\b|\bwithout (an? )?(comp|application|audition|tryout)\b|\bno cutoffs?\b|\b(anyone|everyone|any \w+ (student|undergraduate)s?)\b[^.!?]{0,40}\b(can|may) (join|be a member|become a member)\b|\bcan be a member\b|\bjust (show up|come)\b|\bjoin (us |our program )?at any time\b/i;

export function explicitlyOpen(quote: string): boolean {
  return EXPLICIT_OPEN.test(quote);
}

// --- Weekdays -------------------------------------------------------------------------------------

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The one weekday a date's source text names (0 = Sunday), or null if none or several. */
export function statedWeekday(text: string): number | null {
  const all = text.toLowerCase().match(/\b(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\b/g);
  if (!all) return null;
  const keys = new Set(all.map((w) => w.slice(0, 3)));
  if (keys.size !== 1) return null;
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf([...keys][0] ?? "");
}

/** Weekday (0 = Sunday) of the calendar date an ISO date/datetime string starts with. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * "Saturday, Feb. 26" stored as 2027-02-26 (a Friday): the page is from a year when Feb. 26
 * was a Saturday, so the inferred year is wrong. Returns why, or null when they agree.
 */
export function weekdayProblem(sourceText: string, isoAt: string): QuoteProblem | null {
  const stated = statedWeekday(sourceText);
  if (stated === null || stated === weekdayOf(isoAt)) return null;
  return {
    check: "weekday_mismatch",
    why: `"${sourceText.slice(0, 80)}" says ${DAYS[stated]}, but ${isoAt.slice(0, 10)} is a ${DAYS[weekdayOf(isoAt)]}: the page is from another year`,
  };
}

// --- Event dates ----------------------------------------------------------------------------------

/** Dates that belong to an event or a volunteer schedule, never to an application window. */
export const EVENT_NOT_APPLICATION =
  /\b(open rehearsals?|rehearsal|party|darty|mixer|open house|open mic|info(?:rmation)? session|study break|concert|performance|showcase|gala|banquet|shift assignments?|shifts?|volunteer schedule|newsletter|(?:early )?renewal|renew your|teams? (?:are|will be) (?:selected|matched)|(?:are|will be) notified|venue applications?|applications? to [\w ]{0,40}(?:theater|theatre)|apply to (?:direct|produce|stage[- ]manage|design)|(?:theater|theatre|pool|show|production) applications?)\b/i;

/** A conference's or event's registration window ("Early Bird Registration Deadline"). */
export const EVENT_REGISTRATION =
  /\b(?:early[- ]bird|priority|general|late|delegate|delegation|session [ivx\d]+|conference|tournament|hackathon)\s+registration\b|\bregistration (?:opens|deadline|closes)\b/i;

export function eventDateProblem(text: string): QuoteProblem | null {
  const m = text.match(EVENT_NOT_APPLICATION)?.[0] ?? text.match(EVENT_REGISTRATION)?.[0];
  return m
    ? { check: "event_date_not_application", why: `the date is for an event ("${m}"), not an application window` }
    : null;
}

/**
 * A deadline for a later step or an early round, not for applying: "Second Round
 * Applications are due at 11:59PM on the 24th" (only for those who passed round one),
 * "Priority Deadline: September 12th" when a general deadline follows (1.13.0). The
 * application closes at the first-round or general deadline; unknown beats a wrong one.
 */
const LATER_STEP_DEADLINE =
  /\b(?:second|2nd|third|3rd|final|later)[- ](?:round|stage)\b|\bround (?:2|two|3|three)\b|\b(?:priority|early(?:[- ](?:action|bird|decision))?)\s+(?:application\s+)?deadline\b|\b(?:priority|early)\s+applications?\s+(?:are\s+)?due\b/i;

export function laterStepDeadlineProblem(text: string): QuoteProblem | null {
  const m = text.match(LATER_STEP_DEADLINE)?.[0];
  return m
    ? {
        check: "deadline_not_for_applying",
        why: `"${m}" is a later step or an early round, not the application deadline`,
      }
    : null;
}

/** The same check on a stored quote, looking just before the date the claim was read from. */
export function laterStepDeadlineInQuote(quote: string, sourceText: string): QuoteProblem | null {
  const at = quote.indexOf(sourceText.slice(0, 20));
  if (at < 0) return null;
  return laterStepDeadlineProblem(quote.slice(Math.max(0, at - 45), at + 25));
}

// --- Applications from outsiders --------------------------------------------------------------

/**
 * An application window for people who aren't joining the club: a scholarship or financial
 * aid for a conference, a contest's entries, delegates or attendees. "Scholarship
 * Applications are due on October 8th" on a high-school conference's site is not recruiting.
 */
export const OUTSIDER_APPLICATION =
  /\b(scholarships?|financial aid|entries|entry (?:form|deadline)|essay contest|writing contest|delegates?|delegations?|attendees?|attendance fee|conference fee|registration fee|for (?:all |US |U\.S\. |international |new )?chapters|(?:club |research |travel )?grant applications?|funding applications?|(?:medical|law|business|graduate|med|nursing) school|college admissions?|admissions (?:email|newsletter|process)|(?:helps?|helping|guides?|guiding|assists?|assisting) (?:[\w-]+ ){0,4}(?:with|through) (?:the|their|your) (?:[\w-]+ )?application)\b/i;

/** A job someone else is hiring for, shared by the club ("BIT is Hiring in London, Apply by…"). */
const JOB_POSTING = /\b(?:is|are) hiring\b|\bhiring (?:a|an|two|three|several)\b|\bjob (?:postings?|openings?)\b/i;

/** A page whose applications are for outside participants (high-school students, conference attendees). */
const OUTSIDER_PAGE =
  /\bgraduate students (?:are )?invited to apply\b|\bsummer institute\b|\bteen change[- ]?makers\b|\bteens (?:can|may|should) apply\b|\bcollege applications?\b|\bhigh[- ]school(?:ers| students)\b|\bgrades? 9\s*(?:-|–|to|through)\s*12\b|\bconference (?:attendance )?fees?\b|\battendance fees?\b|\b(?:essay|writing) (?:contest|competition)\b|\bdelegate applications?\b|\btech(?:nology)? transfer offices?\b|\baccelerator (?:program|cohort)\b|\bpitch (?:competition|your startup)\b/i;

/** …unless it also recruits the club's own members or staff. */
const MEMBER_RECRUITING =
  /\b(?:interested in joining|join us|join (?:our|the) (?:team|club|board|staff|secretariat|organizing committee)|staff applications?|board applications?|become a (?:member|staffer|staff member)|new members|member applications?|comp(?:ing)? process|recruiting (?:new )?(?:members|staff)|volunteers? (?:should |can |may |must )?(?:apply|fill out)|apply (?:to|as an?) volunteer|volunteer (?:common )?app(?:lication)?|(?:pbha )?common app(?:lication)?)\b/i;

/** How far around the date's sentence the page is read for who the application is for. */
const OUTSIDER_WINDOW = 500;

/**
 * Whether an application date belongs to outsiders: the sentence says so, or the text
 * around it on the page is about a program for high-school students or conference
 * attendees and the page never mentions recruiting its own members. Only nearby text
 * counts: a club page that mentions a high-school outreach project elsewhere still
 * recruits its own members. Returns why, or null.
 */
export function outsiderApplicationProblem(sentence: string, pageText = ""): QuoteProblem | null {
  const job = sentence.match(JOB_POSTING)?.[0];
  if (job) return { check: "outsider_application", why: `a job posting ("${job}"), not the club recruiting` };
  const s = sentence.match(OUTSIDER_APPLICATION)?.[0];
  if (s && !MEMBER_RECRUITING.test(sentence))
    return {
      check: "outsider_application",
      why: `the application is for outside participants ("${s}"), not membership`,
    };
  if (!pageText || MEMBER_RECRUITING.test(pageText)) return null;
  const flat = (t: string) => t.replace(/\s+/g, " ");
  const page = flat(pageText);
  const at = page.indexOf(flat(sentence).trim());
  if (at < 0) return null;
  const near = page.slice(Math.max(0, at - OUTSIDER_WINDOW), at + sentence.length + OUTSIDER_WINDOW);
  const p = near.match(OUTSIDER_PAGE)?.[0];
  return p
    ? {
        check: "outsider_application",
        why: `the application is for outside participants ("${p}" nearby), not membership`,
      }
    : null;
}

/** Link labels and paths of forms for outsiders: scholarships, delegate registration, contest entries. */
const OUTSIDER_LINK =
  /\b(scholarships?|financial[- _]aid|delegates?|delegations?|essay[- _]contest|contest[- _]entry|attendees?|tickets?|alumni|partner(?:ing|s|ship)?|sponsors?(?:hip)?|donat(?:e|ions?)|judges?|contests?|mailing[- _]lists?|listserv|endorsements?|grants?|declar(?:e|ation|ations)|board[- _]chats?|zoom|outreach[- _]log|(?:stock|case|pitch)[- _](?:pitch[- _])?(?:comps?|competitions?|challenges?))\b/i;

/**
 * Whether an "application" link is really for outsiders: the label, the link's path, or
 * the page it sits on (a form linked from "Full Scholarship Application" is that form).
 * Each text is checked as written and with URL separators read as spaces. Returns why, or null.
 */
export function outsiderLinkProblem(...texts: (string | null | undefined)[]): QuoteProblem | null {
  for (const t of texts) {
    if (!t) continue;
    let readable = t;
    try {
      readable = /^https?:\/\//.test(t) ? decodeURIComponent(new URL(t).pathname) : t;
    } catch {
      // Not a URL: read it as text.
    }
    const m = readable.replace(/[-_/]+/g, " ").match(OUTSIDER_LINK)?.[0];
    if (m && !MEMBER_RECRUITING.test(readable.replace(/[-_/]+/g, " ")))
      return { check: "outsider_link", why: `the form is for outside participants ("${m}"), not joining the club` };
  }
  return null;
}

// --- Negated joining processes ----------------------------------------------------------------

const PROCESS_WORD: Record<string, RegExp> = {
  audition: /\bauditions?\b/gi,
  tryout: /\btry-?outs?\b/gi,
  comp: /\bcomp(?:s|ing)?\b/gi,
  application: /\bapplications?\b/gi,
};
const NEGATION_BEFORE =
  /\b(?:no|non|without(?: an?| any)?|not require(?: an?| any)?|(?:doesn'?t|does not|don'?t|do not) (?:require|hold|have|need)(?: an?| any)?|(?:doesn'?t|does not|don'?t|do not|never) (?:[\w-]+ ){1,3}(?:or|nor) (?:require|hold|have|need)(?: an?| any)?|never)[\s-]*(?:formal\s+|prior\s+)?["“'‘]?$/i;

/**
 * "No auditions", "our non-audition policy", "we have no comp process": the quote names a
 * selective process only to say there isn't one. Returns why when every mention of the
 * process is negated, or null.
 */
export function negatedProcessProblem(mode: string, quote: string): QuoteProblem | null {
  const re = PROCESS_WORD[mode];
  if (!re) return null;
  const mentions = [...quote.matchAll(new RegExp(re.source, re.flags))];
  if (!mentions.length) return null;
  const negated = mentions.filter((m) => NEGATION_BEFORE.test(quote.slice(Math.max(0, m.index - 40), m.index)));
  return negated.length === mentions.length
    ? { check: "process_negated", why: `the quote says there is no ${mode}: "${quote.slice(0, 90)}"` }
    : null;
}

// --- Leadership applications ------------------------------------------------------------------

/**
 * An application for a leadership or staff role is not how members join: "Board Applications
 * Apply here", "Apply to Join HUMA Board 2025-26!", "apply to be a Freshman Representative on
 * the AAA board", "To apply for a staff role (producer; stage manager…)", a show's venue
 * application ("Applications for the Loeb Proscenium…"). An application
 * reviewed *by* the board ("an interview with members of the Board") still counts. PURE.
 */
const LEADERSHIP_APPLICATION =
  /\b(?:board|e-?board|exec(?:utive)? (?:board|team|committee)|cabinet|officer|leadership) (?:applications?|positions?)\b|\bapply (?:to (?:join |be (?:on |an? )?)?|for (?:a |an )?(?:spot |seat |position |role )?(?:on )?)(?:the |our )?(?:[\w&'’.-]+ ){0,3}?(?:executive |exec )?(?:board|cabinet|committee)\b|\b(?:apply|applications?)\b[^.!?]{0,40}\b(?:staff roles?|officer positions?|(?:freshman|first-year|class) representatives?|leadership (?:roles?|positions?)|board of directors)\b|\bvenue applications?\b|\bapplications? (?:to|for) (?:the )?[\w ]{0,40}(?:theater|theatre|proscenium)\b|\bapply to (?:direct|produce|stage[- ]manage)\b|\b(?:a|the|each) show must\b[^.!?]{0,40}\bapply\b|\b(?:trip )?leader(?:ship)? training (?:program|course)\b/i;

export function leadershipApplicationProblem(quote: string): QuoteProblem | null {
  return LEADERSHIP_APPLICATION.test(quote)
    ? {
        check: "leadership_application",
        why: `an application for a leadership role or a production, not membership: "${quote.slice(0, 90)}"`,
      }
    : null;
}

// --- Self-described selectivity ----------------------------------------------------------------

/** The club's own joining process: recruiting, comps, applications, members it selects. */
const OWN_PROCESS =
  /\b(recruit(?:ing|ment)?|comp(?:ing|s)?|applications?|applicants?|candidates?|selection|select(?:s|ed)?|admit(?:s|ted)?|accept(?:s|ed|ance)|members?|membership|join(?:ing)?|cohort|new (?:analysts|associates|class)|process)\b/i;
/** Selectivity of something else: colleges, jobs, partners, an outward program. */
const OTHER_SELECTIVITY =
  /\b(colleges?|universit(?:y|ies)|schools?|admissions? (?:at|to)|partners?|clients?|companies|firms?|employers?|industry|markets?|internships?|jobs?|positions?|fellowships?|scholarships?|ambassador|grants?|investors?|funds? (?:we|that))\b/i;

/**
 * Whether a "highly competitive / highly selective" sentence describes joining the club
 * itself. "Successful admission at … highly competitive colleges such as Harvard" (an
 * admissions article on a club's site), "a highly selective group of partners" and "a highly
 * selective Global Ambassador Program" are not the club's own process. PURE.
 */
export function selfDescribedSelectivityProblem(sentence: string): QuoteProblem | null {
  const other = sentence.match(OTHER_SELECTIVITY)?.[0];
  if (other)
    return {
      check: "selectivity_not_about_joining",
      why: `the sentence is about ${other.toLowerCase()}, not joining the club`,
    };
  if (!OWN_PROCESS.test(sentence))
    return {
      check: "selectivity_not_about_joining",
      why: "the sentence never mentions the club's recruiting, comp, applications or members",
    };
  return null;
}

// --- Another organization speaking ---------------------------------------------------------------

/** "At College Ready, our mission is…", "Here at X, we…", "X's mission is…": who is speaking. */
const SPEAKER =
  /^(?:At|Here at)\s+([A-Z][\w&.'’ -]{1,50}?),\s+(?:our|we)\b|^([A-Z][\w&.'’ -]{1,50}?)['’]s mission is\b/;
const SPEAKER_NOISE = new Set([
  "harvard",
  "college",
  "undergraduate",
  "the",
  "of",
  "and",
  "for",
  "at",
  "club",
  "society",
  "group",
  "team",
  "association",
  "organization",
  "inc",
  "llc",
]);

/**
 * Whether a description is another organization speaking: it opens "At X, our/we …" (or
 * "X's mission is …") and X shares no distinctive word or acronym with the club. Sponsored
 * articles on a club's site ("At College Ready, our mission is to help families…") are not
 * the club's mission. PURE.
 */
export function otherOrganizationProblem(
  text: string,
  club: { name: string; acronym: string | null; aliases: readonly string[] },
): QuoteProblem | null {
  const m = SPEAKER.exec(text.trim());
  const speaker = (m?.[1] ?? m?.[2] ?? "").trim();
  if (!speaker) return null;
  const words = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !SPEAKER_NOISE.has(w));
  const own = new Set([club.name, ...club.aliases].flatMap(words));
  const spoken = words(speaker);
  const acronyms = [club.acronym, ...club.aliases.filter((a) => /^[A-Z0-9&]{2,10}$/.test(a))]
    .filter((a): a is string => Boolean(a))
    .map((a) => a.toLowerCase());
  // The club's initials ("HESIRC" for Harvard Extension School International Relations Club).
  for (const n of [club.name, ...club.aliases]) {
    const all = n
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w && !/^(of|and|the|for|at|in|on|a|an)$/i.test(w));
    acronyms.push(
      all
        .map((w) => w[0])
        .join("")
        .toLowerCase(),
    );
  }
  if (spoken.length === 0 || spoken.some((w) => own.has(w) || acronyms.includes(w))) return null;
  return { check: "description_other_organization", why: `the text speaks for "${speaker}", not the club` };
}

// --- Articles and posts --------------------------------------------------------------------------

/**
 * A blog post, news item or archived article rather than a page about the club: dated paths
 * ("/2019/10/…", "/blog/2025/1/9/…"), post archives, case studies. Its title or lede is
 * about its own topic ("What if EA has more in common with deontology…"), never the club's
 * description. PURE.
 */
export function isArticleUrl(url: string): boolean {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  return (
    /\/(?:19|20)\d{2}\/\d{1,2}\//.test(path) ||
    /\/(?:blog|blogs|posts?|articles?|stories|pubarchives|case-stud(?:y|ies))(?:\/|-|$)/.test(path) ||
    /\/news\/[^/]+/.test(path)
  );
}

// --- Join modes ---------------------------------------------------------------------------------

/** Auditions for other organizations, in a bio or alumni note ("allowed me to audition for the best companies"). */
const OUTSIDE_AUDITION =
  /\baudition(?:ed|ing)? (?:for|with) (?:the )?(?:best |top |professional |major )?(?:companies|conservator(?:y|ies)|programs|schools|orchestras across|broadway)\b/i;
/** "Attend Punch events and possibly gain membership", "upon completion of fellowship": a process, not attendance. */
const NOT_ATTENDANCE = /\bpunch\w*\b|\b(?:upon|after) (?:successful )?complet(?:e|ion|ing)\b|\bpossibly gain\b/i;
/** "7:00 PM: Invitation Only": a guest list for one event, not how members join. */
const EVENT_INVITATION =
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b(?:dinner|reception|gala|party|event|screening|talk)\b[^.!?]{0,40}\binvitation[- ]only\b/i;

/**
 * Whether a quote supports the join mode it was extracted for, in one place for the
 * deterministic extractor, LLM grounding and the audit (ADR 0041): open membership must
 * be about joining; a selective process must not be negated ("we do not … require
 * auditions"), for outsiders (grants, other schools' admissions, a conference's
 * scholarships), a board or venue application, someone's audition elsewhere, or a single
 * event's guest list. Returns why, or null. PURE.
 */
export function joinModeProblem(mode: string, quote: string, pageText = ""): QuoteProblem | null {
  if (mode === "open") return openMembershipProblem(quote);
  const negated = negatedProcessProblem(mode, quote);
  if (negated) return negated;
  if (mode === "attendance_based") {
    const m = quote.match(NOT_ATTENDANCE)?.[0];
    return m ? { check: "attendance_not_attendance", why: `membership isn't by attendance here ("${m}")` } : null;
  }
  if (mode === "invite_only")
    return EVENT_INVITATION.test(quote)
      ? { check: "invitation_event", why: `an event's guest list, not membership: "${quote.slice(0, 90)}"` }
      : null;
  if (mode === "audition" && OUTSIDE_AUDITION.test(quote))
    return { check: "outsider_audition", why: `an audition for another organization: "${quote.slice(0, 90)}"` };
  const outsider = outsiderApplicationProblem(quote, pageText);
  if (outsider) return outsider;
  return mode === "application" ? leadershipApplicationProblem(quote) : null;
}

// --- Eligibility --------------------------------------------------------------------------------

const CLASS_NAMED: Record<string, RegExp> = {
  first_year: /\b(?:first[- ]?years?|freshm[ae]n|frosh)\b/i,
  sophomore: /\bsophomores?\b/i,
  junior: /\bjuniors?\b/i,
  senior: /\bseniors?\b/i,
  graduate: /\b(?:grad(?:uate)?s?|ph\.?d|mba|professional school)\b/i,
};

/**
 * Whether a quote supports a class-year claim (ADR 0041), shared by LLM grounding and the
 * audit: a list with first-years needs a sentence the shared reader takes as opening
 * membership to them ("open to all undergraduates", "first-years welcome") — not "Freshman
 * Welcome Event" or "includes both undergraduates and graduates"; a list without them needs
 * a restriction, or every listed year named. Returns why, or null. PURE.
 */
export function eligibleClassesProblem(classes: readonly string[], quote: string): QuoteProblem | null {
  const e = classEligibility(quote, "membership");
  if (classes.includes("first_year"))
    return e?.firstYears === true
      ? null
      : {
          check: "eligibility_unsupported",
          why: `the quote doesn't open membership to first-years: "${quote.slice(0, 90)}"`,
        };
  if (e?.firstYears === false || classes.every((c) => CLASS_NAMED[c]?.test(quote))) return null;
  return { check: "eligibility_unsupported", why: `the quote doesn't name these class years: "${quote.slice(0, 90)}"` };
}

/** Same for an explicit first-years yes/no. */
export function freshmenEligibleProblem(value: boolean, quote: string): QuoteProblem | null {
  const e = classEligibility(quote, "membership");
  return e?.firstYears === value
    ? null
    : {
        check: "eligibility_unsupported",
        why: `the quote doesn't say first-years ${value ? "can" : "can't"} join: "${quote.slice(0, 90)}"`,
      };
}

// --- Navigation / call-to-action text ---------------------------------------------------------

/** Button and card labels that scraped page furniture leaves inside a "paragraph". */
const CTA_PHRASE =
  "learn more|read more|see more|find out more|view more|view all|click here|get started|sign up now|shop now|explore more|more info|see details";
const CTA_ALLCAPS = new RegExp(`\\b(?:${CTA_PHRASE.toUpperCase()})\\b`);
const CTA_TRAILING = new RegExp(`(?:^|[.!?]\\s*)(?:${CTA_PHRASE})\\W*$`, "i");

/**
 * A description or mission that is really card/nav text: a button label in capitals
 * ("... fulfill our mission. LEARN MORE") or a call to action closing the text. Returns
 * why, or null. PURE.
 */
export function navTextProblem(text: string): QuoteProblem | null {
  const caps = text.match(CTA_ALLCAPS)?.[0];
  if (caps) return { check: "nav_text", why: `page furniture ("${caps}") inside the text` };
  const tail = text.match(CTA_TRAILING)?.[0].trim();
  if (tail) return { check: "nav_text", why: `ends with a call to action ("${tail}")` };
  return null;
}

/**
 * "Rolling" as the club's usual way of recruiting. Not "some of these programs may conduct
 * interviews on a rolling basis ahead of the priority deadline": that is early review of some
 * programs' applicants before a fixed deadline, so the club has a deadline cycle, not rolling
 * admission.
 */
export function rollingProblem(quote: string): QuoteProblem | null {
  const hedged =
    /\b(some|certain|several|a few|many)\s+(?:of\s+)?(?:these|the|our|those)?\s*[a-z ]{0,30}?\b(may|might|can|could)\b/i;
  const aheadOfDeadline =
    /\brolling\b[^.]{0,60}\b(ahead of|before|prior to|until)\b[^.]{0,30}\bdeadline\b|\b(priority|early|final)\s+deadline\b/i;
  if (!/rolling/i.test(quote)) return null;
  if (hedged.test(quote) || aheadOfDeadline.test(quote))
    return {
      check: "rolling_not_usual",
      why: `"${quote.slice(0, 90)}" is early review before a deadline, not rolling recruiting`,
    };
  return null;
}
