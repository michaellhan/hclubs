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
  // "We meet every Tuesday for 1 hour": one meeting's length, not the week's commitment (round 3,
  // Startups showed "1 h/week"). The registry has no meeting qualifier, so such a claim is dropped.
  const meeting = quote.match(MEETING_LENGTH)?.[0];
  if (meeting && !WEEK_TOTAL.test(quote))
    return { check: "hours_meeting_length", why: `a meeting's length ("${meeting}"), not hours per week` };
  return null;
}

/** A meeting's, practice's or rehearsal's own length. */
const MEETING_LENGTH =
  /\b(?:meet|meets|meeting|meetings|gather|gathers|rehearse|rehearses|practice|practices)\b[^.;!?]{0,40}?\bfor\s+(?:about\s+|around\s+|roughly\s+|an?\s+)?(?:\d+(?:\.\d+)?|an?|one|two|three)\s+(?:hours?|hrs?)\b|\b\d+(?:\.\d+)?[- ](?:hour|hr)\s+(?:meetings?|sessions?|practices?|rehearsals?)\b/i;
/** The quote states a weekly figure ("6 hours a week", "per week", "a total of 7 hours"). */
const WEEK_TOTAL =
  /\b(?:hours?|hrs?)\s*(?:per|a|each|every|\/)\s*week\b|\bweekly\s+(?:commitment|total|time)\b|\b(?:a\s+)?total\s+of\b|\bin\s+total\b|\bper\s+week\b|\ba\s+week\b/i;

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

/** "Eligibility. Open to all Harvard affiliates.": who may apply to something, not open membership (2026-10-12). */
const OPEN_ELIGIBILITY = /\beligib(?:le|ility)\b/i;

export function openMembershipProblem(quote: string): QuoteProblem | null {
  if ((OPEN_ABOUT_PROCESS.test(quote) || OPEN_ELIGIBILITY.test(quote)) && !NO_PROCESS.test(quote))
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

/**
 * A month and day whose year was inferred from the crawl date, but the text around it says
 * which year it was: "auditions for the 2025-2026 school year on Sept 16" (a fall date of
 * that academic year is in 2025, a spring date in 2026), or a post whose address is dated
 * ("/shows/2025/9/16/auditions-2025") more than ten months before the inferred date or after
 * it. Such a date belongs to an old cycle. PURE.
 */
export function inferredYearProblem(sentence: string, at: string, pageUrl = ""): QuoteProblem | null {
  const date = new Date(`${at.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const ay = /\b(20\d{2})\s*[-–—/]\s*(?:20)?(\d{2})\b/.exec(sentence);
  if (ay?.[1] && ay[2]) {
    const first = Number(ay[1]);
    const second = 2000 + Number(ay[2]);
    if (second === first + 1) {
      // Applications *for* a year or season close before it starts or early in it: "Applications
      // for our 2026–27 season are now open! All applications are due February 6" is Feb 2026
      // (Fed Challenge, which recruits the spring before its fall competition; 1.16.38).
      const forTheYear = new RegExp(
        String.raw`\b(?:applications?|apply|recruit\w*)\b[^.!?]{0,30}\bfor (?:our |the |this )?${ay[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i",
      ).test(sentence);
      const expected = forTheYear || month >= 7 ? first : second;
      if (year !== expected)
        return {
          check: "inferred_year",
          why: `the text names the ${first}-${second} year, so this date was in ${expected}`,
        };
    }
  }
  const posted = /\/(20\d{2})\/(\d{1,2})(?:\/(\d{1,2}))?\//.exec(pageUrl);
  if (posted?.[1] && posted[2]) {
    const postedAt = Date.UTC(Number(posted[1]), Number(posted[2]) - 1, Number(posted[3] ?? 1));
    const days = (date.getTime() - postedAt) / 86_400_000;
    if (days < -31 || days > 305)
      return {
        check: "inferred_year",
        why: `the post is dated ${posted[1]}-${posted[2]}, so this date isn't in ${year}`,
      };
  }
  return null;
}

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
  /\b(scholarships?|financial aid|entries|entry (?:form|deadline)|essay contest|writing contest|delegates?|delegations?|attendees?|participants?['’]s? (?:place|spot)|hacker applications?|attendance fee|conference fee|registration fee|for (?:all |US |U\.S\. |international |new )?chapters|(?:club |research |travel )?grant applications?|funding applications?|(?:medical|law|business|graduate|med|nursing) school|college admissions?|admissions (?:email|newsletter|process)|(?:helps?|helping|guides?|guiding|assists?|assisting) (?:[\w-]+ ){0,4}(?:with|through) (?:the|their|your) (?:[\w-]+ )?application)\b/i;

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

// --- Program applications (grants, treks, scholarships) ------------------------------------------

/** A program the club runs or funds, which students apply to without joining by it. */
const PROGRAM = String.raw`(?:grants?|treks?|trips?|retreats?|scholarships?|funding|stipends?|awards?|prizes?)`;
/**
 * An application for one of the club's programs, said in the sentence: "Applications for the
 * Spring 2026 Trek have closed", "apply for a member grant", "trek applications". A fellowship
 * counts only beside money ("fellowships of up to $5,000"): at many clubs an intro fellowship
 * is how members join (AISST, Effective Altruism), so a bare "fellowship application" stays.
 */
const PROGRAM_APPLICATION = new RegExp(
  String.raw`\b${PROGRAM} applications?\b|\bapplications? (?:for|to) (?:the |our |a |an |this year's |next year's )?(?:[\w&'’.-]+ ){0,4}?${PROGRAM}\b|\bapply (?:for|to) (?:the |our |a |an |this year's )?(?:[\w&'’.-]+ ){0,4}?${PROGRAM}\b|\bfellowships?\b[^.!?]{0,60}(?:\$\s?\d|\bfunding\b|\bstipends?\b|\bgrants?\b)|(?:\$\s?\d|\bfunding\b|\bstipends?\b)[^.!?]{0,60}\bfellowships?\b`,
  "i",
);
/** A section heading that names such a program ("Member Grants", "Startup Trek", "Travel Awards"). */
const PROGRAM_HEADING = new RegExp(String.raw`\b${PROGRAM}\b`, "i");
/** The sentence itself is about joining, whatever its section ("apply to join", "new members"). */
const JOINING_WORDS =
  /\b(?:join(?:ing)?|membership|new members?|become (?:a )?members?|recruit\w*|comp(?:ing|s)?|auditions?|try-?outs?)\b/i;

/**
 * The section heading a sentence sits under on its page (the nearest markdown heading above
 * it in the page text the extractors read), or null. Whitespace in the sentence may differ
 * from the page's. PURE.
 */
export function headingAbove(pageText: string, sentence: string): string | null {
  const words = sentence.trim().split(/\s+/).slice(0, 10);
  if (!pageText || words.length === 0 || !words[0]) return null;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  const m = re.exec(pageText);
  if (!m) return null;
  const lines = pageText.slice(0, m.index).split("\n");
  // The last line is the start of the sentence's own line: a heading there is the sentence itself.
  for (let i = lines.length - 2; i >= 0; i--) {
    const h = /^#{1,6}\s+(.+)$/.exec(lines[i] ?? "");
    if (h?.[1]) return h[1].trim().slice(0, 120);
  }
  return null;
}

/**
 * An application for a program the club runs (a trek, a grant, a scholarship, a funded
 * fellowship), not for membership: the sentence says so, or it sits under a heading naming the
 * program ("### Member Grants … Applications are reviewed on a rolling basis", "### Startup
 * Trek … Apply by October 10") and never mentions joining. Startups at Harvard's trek deadline
 * and grant review read as "Application" and "Usually recruits on a rolling basis" (2026-10-12).
 * Used for join modes, recruiting seasons, dates and links. Returns why, or null. PURE.
 */
export function programApplicationProblem(sentence: string, pageText = ""): QuoteProblem | null {
  if (MEMBER_RECRUITING.test(sentence)) return null;
  const said = sentence.match(PROGRAM_APPLICATION)?.[0];
  if (said)
    return {
      check: "program_application",
      why: `an application for one of the club's programs ("${said}"), not membership`,
    };
  if (!pageText || JOINING_WORDS.test(sentence)) return null;
  const heading = headingAbove(pageText, sentence);
  const named = heading?.match(PROGRAM_HEADING)?.[0];
  if (!heading || !named || JOINING_WORDS.test(heading) || MEMBER_RECRUITING.test(heading)) return null;
  return {
    check: "program_application",
    why: `under "${heading}": an application for one of the club's programs ("${named}"), not membership`,
  };
}

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
  const program = programApplicationProblem(sentence, pageText);
  if (program) return program;
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
  if (p)
    return {
      check: "outsider_application",
      why: `the application is for outside participants ("${p}" nearby), not membership`,
    };
  return conferenceRegistrationProblem(pageText);
}

// --- Activities ----------------------------------------------------------------------------------

/** Electing or running for the club's own board: how it is governed, not what members do. */
const GOVERNANCE =
  /\b(?:board|officers?|e-?board|executive|leadership|president|positions?)\b[^.;]{0,40}\belect(?:ed|s|ion|ions)\b|\belect(?:ed|s|ion|ions)\b[^.;]{0,30}\b(?:board|officers?|leaders?|president)\b|\brun\s+for\s+(?:the\s+)?(?:board|office|officer|positions?)\b/i;

/**
 * An activity line that is the club's governance ("Annual Board of Directors elections",
 * "Members can run for the Board of Directors, which is elected each December"), not
 * something members do (round 3, Ballet Company). Returns why, or null. PURE.
 */
export function governanceActivityProblem(text: string): QuoteProblem | null {
  const m = text.match(GOVERNANCE)?.[0];
  return m ? { check: "activity_governance", why: `board elections aren't an activity ("${m}")` } : null;
}

// --- Conference registration pages ----------------------------------------------------------------

/** One phrase settles it: a conference's registration system, per-delegate fees, other students only. */
const CONFERENCE_STRONG =
  /\bcollege students are (?:not|in)eligible\b|\bmunager\b|\b(?:per|each) (?:delegate|delegation)\b|\bdelegate fees?\b|\bdelegation (?:size|fees?|registration)\b|\bconference registration\b/i;
/** Three of these together: who registers, who chaperones and when registration closes. */
const CONFERENCE_SIGNALS = [
  /\bdelegat(?:es?|ions?)\b/i,
  /\bhigh[- ]schools?\b/i,
  /\bfaculty advisors?\b/i,
  /\bregistration (?:opens|deadlines?|fees?|timeline)\b/i,
  /\b(?:university|college) students? (?:currently )?pursuing\b/i,
];

/**
 * A conference's registration page: high-school or other universities' delegations apply
 * through it ("college students are not eligible to apply for HMUN 2027", "applications
 * submitted directly via our conference registration system, MUNager"). Its applications,
 * deadlines, "rolling" review and "all students" welcome are for delegates, not how
 * Harvard students join the club that runs the conference (HMUN and HNMUN read as
 * "Application · First-years eligible" and "rolling", 2026-10-12). A page that also recruits
 * the club's own staff ("staff applications", "IRC Common App") is not one. Judged on the
 * whole page. Returns why, or null. PURE.
 */
export function conferenceRegistrationProblem(pageText: string): QuoteProblem | null {
  if (!pageText || MEMBER_RECRUITING.test(pageText)) return null;
  const strong = pageText.match(CONFERENCE_STRONG)?.[0];
  const hits = CONFERENCE_SIGNALS.map((r) => pageText.match(r)?.[0]).filter((h): h is string => !!h);
  if (!strong && hits.length < 3) return null;
  return {
    check: "conference_registration",
    why: `a conference registration page for delegates ("${strong ?? hits.join('", "')}"), not how members join`,
  };
}

/** Link labels and paths of forms for outsiders: scholarships, delegate registration, contest entries. */
const OUTSIDER_LINK =
  /\b(scholarships?|financial[- _]aid|delegates?|delegations?|essay[- _]contest|contest[- _]entry|attendees?|tickets?|alumni|partner(?:ing|s|ship)?|sponsors?(?:hip)?|donat(?:e|ions?)|judges?|contests?|mailing[- _]lists?|listserv|endorsements?|grants?|treks?|trips?|retreats?|stipends?|funding|declar(?:e|ation|ations)|board[- _]chats?|zoom|outreach[- _]log|(?:stock|case|pitch)[- _](?:pitch[- _])?(?:comps?|competitions?|challenges?))\b/i;

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

// Moved to @hci/core (normalize/urls.ts) so the profile query can use them too.
export { isArticleUrl, isLegalPageUrl } from "@hci/core";

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

// --- People named in club text (CLAUDE.md §4, §21) ------------------------------------------------

/**
 * Text that names people as the club's leaders or contacts ("led by Jane Doe and John
 * Roe", "contact one of our comp directors, Jane Doe"). §21: no officer or member names.
 * The keyword is matched case-insensitively; the name must be capitalized words.
 */
const LEADER_KEYWORD =
  /\b(led by|run by|founded by|co-?founded by|founders?(?:,| were| are|:| include)|(?:co-?)?presidents?(?:,| are| is|:)|(?:comp )?directors?(?:,| are| is|:)|chairs?(?:,| are|:)|contact(?: one of)?(?: our)?(?: [a-z]+)*?[,:])\s+/gi;
const LEADER_NAME = /^([A-Z][a-z]+(?:-[A-Z][a-z]+)?(?: [A-Z]\.)? [A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b/;
const NOT_A_PERSON =
  /^(Harvard|Radcliffe|The|Board|Student|College|Club|Society|Program|Boston|Cambridge|New|United|Model|Undergraduate|Executive|Senior|Associate|Business|Corporate|Music|Artistic|Faculty|Our|Choral)\b/;

/**
 * A name introduced by who the person is: "Jane Doe and John Roe, two college freshmen",
 * "Jane Doe, a junior". Founding stories name students this way without "founded by".
 */
const NAMED_STUDENT =
  /(?<![A-Z][\w’'-]* |[-’'])\b([A-Z][a-z]+(?:-[A-Z][a-z]+)? [A-Z][a-z]+(?:-[A-Z][a-z]+)?)(?: and [A-Z][a-z]+(?:-[A-Z][a-z]+)? [A-Z][a-z]+(?:-[A-Z][a-z]+)?)?, (?:(?:two|three|four|both|a|an|then|then a|then an|fellow) )?(?:[a-z]+ ){0,2}(?:students?|freshm[ae]n|first-years?|sophomores?|juniors?|seniors?|undergraduates?|alumn(?:us|a|i|ae))\b(?!-)/g;

/** Words that make a capitalized pair an organization or place, not a person. */
const ORG_WORD =
  /\b(Association|Society|Congress|Company|Court|Council|Club|Group|Initiative|Committee|Foundation|International|American|Asian|Asia|Africa|African|Europe|European|Humanity|Harvard|Radcliffe|College|University|School|Institute|Center|Centre|Review|Journal|Magazine|Program|Project|Team|Orchestra|Band|Choir|Ensemble|Theater|Theatre|Union|League|Alliance|Network|Collective|Coalition|Lab|Labs)\b/;

/** The first person a text names as a leader or contact, or null. PURE. */
export function namedLeader(text: string): string | null {
  for (const m of text.matchAll(LEADER_KEYWORD)) {
    const rest = text.slice((m.index ?? 0) + m[0].length);
    const name = rest.match(LEADER_NAME)?.[1];
    if (name && !NOT_A_PERSON.test(name)) return name;
  }
  for (const m of text.matchAll(NAMED_STUDENT)) {
    const name = m[1];
    if (name && !NOT_A_PERSON.test(name) && !ORG_WORD.test(name)) return name;
  }
  return null;
}

/** One capitalized name word: "Jane", "McMillan", "O'Neil", "Weil-Bergmann", "José". */
const NAME_WORD = String.raw`[A-Z][a-zà-öø-ÿ]+(?:[A-Z][a-zà-öø-ÿ]+)?(?:[-'’][A-Z][a-zà-öø-ÿ]+)?`;
/** Two or three name words, optionally with a middle initial: "Sarah Erickson", "John F. Kennedy". */
const PERSON = String.raw`(${NAME_WORD}(?:\s+[A-Z]\.)?(?:\s+${NAME_WORD}){1,2})`;
/** A class year right after a name: "'25", "’25", "('25)", "(2010)", ", Class of 2025", "AB '19". */
const CLASS_YEAR = String.raw`(?:\s*[‘’'][0-9]{2}(?![0-9’'])|\s*\(\s*(?:[Cc]lass of\s+)?(?:[‘’'][0-9]{2}|(?:19|20)[0-9]{2})\s*\)|,\s+(?:[Cc]lass of|[Cc]\/[Oo])\s+(?:(?:19|20)[0-9]{2}|[‘’'][0-9]{2})|,?\s+(?:A\.?B\.?|S\.?B\.?|A\.?M\.?|M\.?B\.?A\.?|J\.?D\.?|M\.?D\.?|Ph\.?D\.?)\s*[‘’']?[0-9]{2,4})`;
const NAME_WITH_YEAR = new RegExp(`${PERSON}${CLASS_YEAR}`, "g");
/** Either case for a word's first letter: "Directed by" opens a line, "directed by" follows one. */
const anyCase = (words: string) =>
  words
    .split("|")
    .map((w) => `[${w[0]?.toUpperCase()}${w[0]}]${w.slice(1)}`)
    .join("|");
/** A credit: "Directed by Jane Doe", "choreographed by …", "music directed by …". */
const CREDIT = new RegExp(
  String.raw`\b(?:${anyCase("directed|choreographed|produced|written|composed|conducted|arranged|designed|curated|stage-managed|stage managed|co-directed|codirected|co-produced")})\s+by\s+(?:(?:Professor|Prof\.|Dr\.|Mr\.|Ms\.|Mrs\.)\s+)?${PERSON}`,
  "g",
);
/**
 * A list of named practitioners: "Past choreographers and teachers include Jane Doe, …". Not a
 * staff title before a name ("Music Director Federico Cortese", a public role), nor notable
 * alumni ("alumni include Yo-Yo Ma"): public figures, and a class year still counts.
 */
const CREDIT_LIST = new RegExp(
  String.raw`\b(?:${anyCase("choreographers?|directors?|teachers?|instructors?|coaches|guest artists?")})\b(?:\s+and\s+[a-z]+)?(?:\s+(?:have\s+)?(?:include|included|including)|\s+such\s+as|:)\s+${PERSON}`,
  "g",
);
/**
 * Capitalized words that are never a person's name in these patterns (organizations, places,
 * terms, shows): "Spring Show '25", "Harvard College (1636)", "Gilbert and Sullivan Players".
 */
const NOT_NAME_WORD = new Set(
  (
    "Harvard Radcliffe College University School Club Society Association Company Group Team Players Singers " +
    "Orchestra Band Choir Chorus Ensemble Theater Theatre Dance Dancers Company Program Project House Hall Center " +
    "Centre Institute Foundation Council Committee Union League Alliance Network Review Journal Magazine Crimson " +
    "Spring Fall Autumn Winter Summer Show Shows Concert Gala Festival Season Production Tour Class Year Semester " +
    "January February March April May June July August September October November December Annual Night Week " +
    "Boston Cambridge Massachusetts America American New York United States National International World Global " +
    "Student Students Undergraduate Undergraduates Graduate Alumni The Our Their Its This That Each Every Past " +
    "Office Arts Art Department Board Executive Kennedy Business Law Medical Divinity Extension Square Yard Street " +
    "Lab Labs Studio Studios Collective Coalition Initiative Conference Summit Competition Cup Award Awards Prize"
  ).split(" "),
);
const NOT_A_PERSON_WORD = (w: string) => NOT_NAME_WORD.has(w.replace(/[’'].*$/, ""));

function personIn(re: RegExp, text: string, own: string[]): string | null {
  for (const m of text.matchAll(re)) {
    const name = m[1]?.trim();
    if (!name) continue;
    const words = name.split(/\s+/).filter((w) => !/^[A-Z]\.$/.test(w));
    if (words.length < 2 || words.some(NOT_A_PERSON_WORD)) continue;
    // A name that is part of a club's own name: "the John Adams Society ('25 …)" is the club.
    if (own.some((n) => n.includes(name))) continue;
    return name;
  }
  return null;
}

/**
 * Whether free text meant to describe a club (description, mission, activity, summary) names
 * an individual person: a name with a class year ("Sarah Erickson '25", "Julia Havard (2010)",
 * "Jane Doe, Class of 2025"), a production credit ("Directed by …", "choreographed by …"), a
 * list of named choreographers, directors or teachers, or a named leader or contact (`namedLeader`).
 * §4/§21: no individual names in club data. `ownNames` are the club's own names, so a name
 * inside one ("John Adams Society") never counts. Returns why, or null. PURE.
 */
export function namesPeopleProblem(text: string, ownNames: readonly string[] = []): QuoteProblem | null {
  const own = ownNames.filter(Boolean);
  const withYear = personIn(NAME_WITH_YEAR, text, own);
  if (withYear) return { check: "names_people", why: `names a person with a class year ("${withYear}")` };
  const credit = personIn(CREDIT, text, own);
  if (credit) return { check: "names_people", why: `credits a named person ("${credit}")` };
  const listed = personIn(CREDIT_LIST, text, own);
  if (listed) return { check: "names_people", why: `lists named people ("${listed}")` };
  const leader = namedLeader(text);
  if (leader && !own.some((n) => n.includes(leader)))
    return { check: "names_people", why: `names a person ("${leader}")` };
  return null;
}

/** A term and year: "Spring 2024", "Fall '23", "fall 2026". */
const TERM_YEAR = String.raw`(?:spring|fall|autumn|winter|summer)\s+(?:(?:19|20)[0-9]{2}|[‘’'][0-9]{2})\b`;
const STARTS_WITH_TERM = new RegExp(String.raw`^\W*${TERM_YEAR}`, "i");
/** A statement of purpose that belongs to one show: "At the core of our spring 2024 show, we aim to …". */
const SHOW_PURPOSE =
  /\b(?:this|our|the)\s+(?:(?:spring|fall|autumn|winter|summer)\s+)?(?:(?:19|20)[0-9]{2}\s+|[‘’'][0-9]{2}\s+)?(?:show|production|performance|concert|recital|piece|exhibition)\b(?!s)[^.!?]{0,40}\b(?:we aim to|our goal is|we hope to|we seek to)\b/i;

/**
 * Whether text is a show or event blurb rather than what the club is: it starts with a term and
 * year ("Spring 2024 the eleventh hour …") or its statement of purpose is one production's
 * ("At the core of our spring 2024 show, we aim to …"). Never a description or mission. PURE.
 */
export function eventBlurbProblem(text: string): QuoteProblem | null {
  if (STARTS_WITH_TERM.test(text))
    return { check: "event_blurb", why: `starts with a term and year ("${text.match(STARTS_WITH_TERM)?.[0].trim()}")` };
  const show = text.match(SHOW_PURPOSE)?.[0];
  if (show) return { check: "event_blurb", why: `describes one production ("${show.slice(0, 60)}")` };
  return null;
}

// --- About text that isn't about the club (student testing round 4) ----------------------------

/** "It is my honor to welcome you…", "On behalf of our Secretariat, it is with great pleasure…". */
const LETTER_OPENER =
  /\b(?:it is (?:my|our) (?:great |distinct )?(?:honou?r|pleasure|privilege)|(?:it is )?with (?:great |immense )?(?:pleasure|excitement|joy|honou?r) that (?:I|we)|on behalf of (?:the|our|my) [\w\s]{0,40}?(?:secretariat|staff|board|team|committee)|I am (?:thrilled|delighted|honou?red|excited|pleased) to (?:welcome|invite))\b/i;
const WELCOME_YOU = /\b(?:welcome|invite)\s+(?:you|all of you|you all)\b/i;
const EVENT_WORD = /\b(?:delegates?|conference|session|summit|symposium|convention)\b/i;
const FIRST_PERSON = /\b(?:I|I['’](?:m|ve|d|ll)|my)\b/;

/**
 * A letter of welcome or invitation to a conference's delegates ("It is my honor to welcome you
 * to our seventy-fourth session of Harvard Model United Nations…", "On behalf of our Secretariat,
 * it is with great pleasure that I invite you to the 73rd Annual Session…"): it addresses one
 * year's attendees, not students looking for a club. Never About text. PURE.
 */
export function welcomeLetterProblem(text: string): QuoteProblem | null {
  const opener = text.match(LETTER_OPENER)?.[0];
  // "On behalf of the board, we would like to welcome you to join our community" welcomes new
  // members: a letter needs a conference word, or one person ("I") welcoming the reader.
  if (opener && (EVENT_WORD.test(text) || (WELCOME_YOU.test(text) && FIRST_PERSON.test(text))))
    return { check: "welcome_letter", why: `a letter to attendees ("${opener.slice(0, 60)}")` };
  if (/^\W*dear (?:delegates|advisors|faculty advisors|attendees|participants)\b/i.test(text))
    return { check: "welcome_letter", why: "a letter to attendees" };
  if (WELCOME_YOU.test(text) && FIRST_PERSON.test(text) && EVENT_WORD.test(text) && /\b20\d\d\b/.test(text))
    return { check: "welcome_letter", why: "a first-person welcome to one year's event" };
  return null;
}

/** "Women in Medicine hosted a Women's Week Career Panel…": one past event, told as news. */
const PAST_EVENT =
  /^[^.!?]{0,90}?(?<!\b(?:have|has|had|we've|who)\s)\b(?:recently |last (?:week|month|year|semester|fall|spring) |this (?:past )?(?:week|month|semester|fall|spring) )?(?:hosted|held|co-hosted|organized|threw|put on|celebrated)\s+(?:a|an|its|their|our|the)\b/i;
/** A present-tense statement of what the group is or does. */
const PRESENT_DESCRIPTION =
  /\b(?:is|are|aims?|strives?|provides?|offers?|hosts|holds|organizes|works|seeks|serves|brings|connects|fosters|promotes|supports|meets|runs|exists|has been|have been)\b/i;

/**
 * A recap of a single event instead of a description ("Women in Medicine hosted a Women's Week
 * Career Panel, "Bites and Insights," featuring …"): short, opens with what the group did once,
 * and never says what it is or does in the present. PURE.
 */
export function eventRecapProblem(text: string): QuoteProblem | null {
  const t = text.trim();
  if (t.length > 400 || !PAST_EVENT.test(t)) return null;
  // Present-tense words inside quoted event titles don't describe the club.
  const unquoted = t.replace(/[“"][^”"]*[”"]/g, " ");
  if (PRESENT_DESCRIPTION.test(unquoted)) return null;
  return { check: "event_recap", why: `recaps one event ("${t.match(PAST_EVENT)?.[0].slice(0, 70)}")` };
}

/**
 * A notice to visitors, not a description: a markdown-bold or "Please note" opener, "As of
 * Spring 2025 …" status news, or shop talk ("do not purchase these from our site"; the Cycling
 * Club's restart notice). PURE.
 */
const NOTICE_OPENER =
  /^\W*(?:\*\*|please note\b|note:|notice:|important:|attention:|update:|announcement:|as of (?:(?:spring|fall|autumn|winter|summer|january|february|march|april|may|june|july|august|september|october|november|december)\s+)?(?:19|20)\d\d\b)/i;
const SHOP_TALK =
  /\b(?:do not|don['’]t|please do not) (?:purchase|buy|order)\b|\bpurchase (?:these|this|it|them|a membership) (?:from|on|through) our (?:site|store|shop|website)\b/i;
export function noticeProblem(text: string): QuoteProblem | null {
  const open = text.match(NOTICE_OPENER)?.[0];
  if (open) return { check: "notice", why: `a notice to visitors ("${open.trim().slice(0, 40)}")` };
  const shop = text.match(SHOP_TALK)?.[0];
  if (shop) return { check: "notice", why: `shop or purchase text ("${shop}")` };
  return null;
}

/** Sentences that only invite the reader somewhere: their "our"/"us" isn't the club describing itself. */
const CTA_SENTENCE =
  /\b(?:click|join our (?:mailing|e-?mail|list|listserv|newsletter)|mailing list|sign up|subscribe|follow us|contact us|e-?mail us|reach out|check out|visit our|find us|like us|message us|dm us)\b/i;
const WE_OUR = /\b(?:we|our|us|we['’](?:re|ve|ll|d))\b/i;
/** Name words that don't identify a club. */
const GENERIC_NAME_WORD =
  /^(?:harvard|radcliffe|undergraduate|undergraduates|college|university|student|students|society|association|organization|group|club|chapter|council|committee|program|project|initiative|network|alliance|coalition|collective|team|union|center|foundation|national|international|american|women|first)$/;

/**
 * Generic text that never makes the club its subject (round 4: the Pre-Medical Society's About is
 * a paragraph on Harvard's pre-med advising, the Office of Career Services and URAF): it doesn't
 * name the club, and its only "our"/"us" is in a call to action ("join our mailing list"). Text
 * that names the club, or speaks as "we" anywhere else, passes. `names` are the club's own names
 * and acronyms. PURE.
 */
export function notAboutClubProblem(text: string, names: readonly string[]): QuoteProblem | null {
  const norm = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const named = names.some((n) => {
    const raw = n.trim();
    const k = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (k.length < 3) return false;
    if (/^[A-Z0-9&.-]{2,10}$/.test(raw)) return new RegExp(`\\b${raw.replace(/[.&-]/g, "\\$&")}\\b`).test(text);
    // The whole name, or a distinctive word of it ("Harvard Synapse" for the Synapse chapter).
    return (
      norm.includes(` ${k} `) ||
      k.split(" ").some((w) => w.length >= 5 && !GENERIC_NAME_WORD.test(w) && norm.includes(` ${w} `))
    );
  });
  if (named) return null;
  const voiced = text.split(/(?<=[.!?])\s+/).filter((s) => WE_OUR.test(s));
  if (!voiced.length || voiced.some((s) => !CTA_SENTENCE.test(s))) return null;
  return { check: "not_about_club", why: "doesn't name the club, and its only “our” is a call to action" };
}

/** The About-text rules that need no club context; the first problem found. PURE. */
export function aboutTextProblem(text: string): QuoteProblem | null {
  return welcomeLetterProblem(text) ?? noticeProblem(text) ?? eventRecapProblem(text);
}
