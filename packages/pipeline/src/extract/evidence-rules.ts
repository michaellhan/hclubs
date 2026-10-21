import { classEligibility, joinQuoteScope, type StageKind } from "@hci/core";
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
// "Membership costs $20 /6 months" (the Outing Club, 2026-10-13): a price on membership itself.
const DUES_WORDS =
  /\b(dues|membership fees?|member fees?|annual fee|semester(ly)? fee|fee to join|cost to join|costs? nothing to join|free to join|no (membership )?(fees?|dues|cost))\b|\bmembership (?:costs?|is) \$/i;
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

/**
 * "…are eligible to attend our classes" (the Karate Club's FAQ, 2026-10-13): eligibility to take
 * part in the club's own regular activity, with no process named, is open membership.
 */
const ELIGIBLE_TO_TAKE_PART =
  /\beligible to (?:attend|join|take part in|participate in) (?:our|the club['’]s|all (?:of )?our) (?:classes|practices|sessions|meetings|club|team|group)\b/i;
const ELIGIBILITY_PROCESS_WORD = /\b(?:apply|applications?|auditions?|comps?|tryouts?|try out|interviews?|selected)\b/i;
const eligibilityToApply = (quote: string) =>
  OPEN_ELIGIBILITY.test(quote) && !(ELIGIBLE_TO_TAKE_PART.test(quote) && !ELIGIBILITY_PROCESS_WORD.test(quote));

export function openMembershipProblem(quote: string): QuoteProblem | null {
  if ((OPEN_ABOUT_PROCESS.test(quote) || eligibilityToApply(quote)) && !NO_PROCESS.test(quote))
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

/**
 * A place or office closed on a date ("PLEASE NOTE: Harvard Yard is closed on October 30th from
 * 2-8 PM", Trademark Tours' employment page, 2026-10-21): a closure notice, not applications
 * closing. A sentence naming applications, forms or a process is left to the deadline rules. PURE.
 */
const CLOSURE = /\b(?:is|are|will be)\s+closed\s+(?:on|for|from|until)\b/i;
const CLOSING_PROCESS = /\b(?:applications?|apps?|forms?|comps?|auditions?|tryouts?|recruit\w*|submissions?|interest)\b/i;
export function closureNoticeProblem(sentence: string): QuoteProblem | null {
  const m = sentence.match(CLOSURE)?.[0];
  return m && !CLOSING_PROCESS.test(sentence)
    ? { check: "closure_notice", why: `a closure notice ("${m}"), not applications closing` }
    : null;
}

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
  /\b(discounts?|lock in (?:your|the|a) (?:price|rate|spot|seat)|(?:early[- ]bird|regular) (?:price|pricing|rate)|scholarships?|financial aid|entries|entry (?:form|deadline)|essay contest|writing contest|delegates?|delegations?|attendees?|participants?['’]s? (?:place|spot)|hacker applications?|attendance fee|conference fee|registration fee|for (?:all |US |U\.S\. |international |new )?chapters|(?:club |research |travel )?grant applications?|funding applications?|(?:medical|law|business|graduate|med|nursing) school|college admissions?|admissions (?:email|newsletter|process)|(?:helps?|helping|guides?|guiding|assists?|assisting) (?:[\w-]+ ){0,4}(?:with|through) (?:the|their|your) (?:[\w-]+ )?application)\b/i;

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
const PROGRAM = String.raw`(?:grants?|treks?|trips?|retreats?|scholarships?|funding|stipends?|awards?|prizes?|incubators?)`;
/**
 * An application for one of the club's programs, said in the sentence: "Applications for the
 * Spring 2026 Trek have closed", "apply for a member grant", "trek applications". A fellowship
 * counts only beside money ("fellowships of up to $5,000"): at many clubs an intro fellowship
 * is how members join (AISST, Effective Altruism), so a bare "fellowship application" stays.
 * An incubator's applications, or applying to be "a member for one of our … projects", are for a
 * program's team, not the club (HUMIC, whose own page says to join the mailing list; round 6).
 */
const PROGRAM_APPLICATION = new RegExp(
  String.raw`\b${PROGRAM} applications?\b|\bapplications? (?:for|to) (?:the |our |a |an |this year's |next year's )?(?:[\w&'’.-]+ ){0,4}?${PROGRAM}\b|\bapply (?:for|to) (?:the |our |a |an |this year's )?(?:[\w&'’.-]+ ){0,4}?${PROGRAM}\b|\bfellowships?\b[^.!?]{0,60}(?:\$\s?\d|\bfunding\b|\bstipends?\b|\bgrants?\b)|(?:\$\s?\d|\bfunding\b|\bstipends?\b)[^.!?]{0,60}\bfellowships?\b|\bmember (?:for|of|on) (?:one (?:of )?)?(?:our|a|the|its) (?:[\w-]+ ){0,3}projects?\b`,
  "i",
);
/** A program's own members or team applying ("Incubator Member Applications", "Trek Participant Application"). */
const PROGRAM_TEAM_APPLICATION = new RegExp(
  String.raw`\b${PROGRAM} (?:member|team|participant|cohort) applications?\b`,
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
  // "AI Project Incubator Member Applications": the program's members, not the club's.
  const team = sentence.match(PROGRAM_TEAM_APPLICATION)?.[0];
  if (team)
    return {
      check: "program_application",
      why: `an application for one of the club's programs ("${team}"), not membership`,
    };
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

/**
 * One phrase settles it: a conference's registration system, per-delegate fees, other students
 * only; or a tournament's team registration, where coaches register a school or group and
 * invite their students (HMMT's "Register a new organization", round 6).
 */
const CONFERENCE_STRONG =
  /\bcollege students are (?:not|in)eligible\b|\bmunager\b|\b(?:per|each) (?:delegate|delegation)\b|\bdelegate fees?\b|\bdelegation (?:size|fees?|registration)\b|\bconference registration\b|\bregister (?:a new|your) (?:organization|school|team)\b|\binvite (?:your )?students\b|\bregistration lottery\b/i;
/** Three of these together: who registers, who chaperones and when registration closes. */
const CONFERENCE_SIGNALS = [
  /\bdelegat(?:es?|ions?)\b/i,
  /\bhigh[- ]schools?\b/i,
  /\bfaculty advisors?\b/i,
  /\bregistration (?:opens|deadlines?|fees?|timeline)\b/i,
  /\b(?:university|college) students? (?:currently )?pursuing\b/i,
  // A tournament's competitors: teams a school sends, their coaches and chaperones.
  /\b(?:competing|accepted|registered) teams\b/i,
  /\bteam rosters?\b/i,
  /\bchaperones?\b/i,
  /\bindividual competitors?\b/i,
];

/**
 * A conference's or tournament's registration page: high-school or other universities' delegations
 * or competing teams apply
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

/** An event or program the page itself is about, in its title or main heading. */
const OUTSIDER_EVENT_TITLE =
  /\b(?:conferences?|summits?|symposi(?:um|a)|summer (?:programs?|institutes?|camps?|academ(?:y|ies))|camps?)\b/i;

/**
 * A page about an event the club runs for outsiders: its title or main heading names a
 * conference, summit, symposium or summer program (the club's own name left out by the
 * caller), and the page speaks to high-school students or attendees (`OUTSIDER_PAGE`) without
 * recruiting the club's own members. Its "Apply Now" form is the event's application, not how
 * members join: VISION Global Health Society's Global Health and Leadership Conference page
 * linked its high-school mentees' form, shown as the club's "How to apply" (round 4,
 * 2026-10-13; extractor 1.16.39–40). Returns why, or null. PURE.
 */
export function outsiderEventPageProblem(
  titles: readonly (string | null | undefined)[],
  pageText: string,
): QuoteProblem | null {
  if (!pageText || MEMBER_RECRUITING.test(pageText)) return null;
  const event = titles.map((t) => t?.match(OUTSIDER_EVENT_TITLE)?.[0]).find((m): m is string => !!m);
  if (!event) return null;
  const who = pageText.match(OUTSIDER_PAGE)?.[0];
  if (!who) return null;
  return {
    check: "outsider_application",
    why: `a page about the club's ${event.toLowerCase()} for outside participants ("${who}"), not how members join`,
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
  return mode === "application" ? (leadershipApplicationProblem(quote) ?? positionApplicationProblem(quote)) : null;
}

const POSITIONS = /\bpositions?\b/i;
/**
 * An application for one of a club's open positions is a role, not membership: "apply to one
 * or more of the available positions" (Plant Based), "positions available", "position
 * applications". A sentence about members ("join the club", "new members") still counts
 * (`joinQuoteScope`, joining-v4). PURE.
 */
export function positionApplicationProblem(quote: string): QuoteProblem | null {
  const scope = joinQuoteScope(quote);
  if (scope.scope !== "role" || scope.role !== "leadership" || !POSITIONS.test(quote)) return null;
  return {
    check: "leadership_application",
    why: `an application for a club position, not membership: "${quote.slice(0, 90)}"`,
  };
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
  return personalBioProblem(text, own);
}

// --- Member and instructor bios (student testing round 6, the Ballroom Dance Club's About) -------

/** Harvard's upperclass houses, as students write them: "a sophomore in Pfoho". */
const HOUSE =
  "Pfoho|Pforzheimer|Currier|Cabot|Mather|Dunster|Leverett|Quincy|Lowell|Eliot|Kirkland|Winthrop|Adams|the Quad|the Yard";
const CLASS_WORD = "first-year|first year|freshman|sophomore|junior|senior";
/**
 * A person introducing themselves: "Hi! I'm Mikayla", "My name is …", "I'm a sophomore …". A
 * club's "we"/"our" never matches.
 */
const SELF_INTRO = new RegExp(
  // Case-sensitive on purpose: the name after "I'm" must be capitalized ("Hi, I'm excited" isn't one).
  String.raw`^\W*(?:[Hh]i|[Hh]ey|[Hh]ello|[Gg]reetings)(?:\s+(?:everyone|all|there|y['’]?all))?\s*[!,.]*\s*(?:I['’]m|I am|[Mm]y name is)\s+[A-Z][a-zà-öø-ÿ]+\b(?![’']s)` +
    String.raw`|\b[Mm]y name is\s+[A-Z][a-zà-öø-ÿ]+` +
    String.raw`|\b(?:I['’]m|I am)\s+(?:[A-Z][a-zà-öø-ÿ]+,\s+)?(?:currently\s+)?(?:a|an)\s+(?:${CLASS_WORD})\b`,
);
/** Anyone's class with a house or concentration: "a sophomore in Pfoho", "a junior studying Math". */
const CLASS_HOUSE = new RegExp(
  String.raw`\b(?:a|an)\s+(?:${CLASS_WORD})\s+(?:(?:in|from|living in)\s+(?:${HOUSE})\b|(?:studying|concentrating in)\s+[A-Z])`,
);
/** "Tola's dance journey", "Jane's career": a person's own story told by name. */
const POSSESSIVE_BIO = new RegExp(
  String.raw`\b(${NAME_WORD})['’]s\s+(?:[a-z]+\s+){0,2}(?:journey|career|training|background)\b`,
  "g",
);
/** "she competes in Open Amateur competitions", "he has taught ballet": a gendered career clause. */
const GENDERED_CAREER =
  /\b(?:[Ss]he|[Hh]e)\s+(?:also\s+|now\s+|currently\s+)?(?:competes|performs|teaches|coaches|trains|dances|choreographs|has\s+(?:competed|performed|taught|coached|trained|danced|choreographed|won|placed|finaled|studied|worked)|(?:began|started)\s+(?:dancing|singing|training|competing|performing)|won|placed|finaled|trained)\b/;
/**
 * "Jane Doe has performed with …": a named person's career. Counts only beside "she"/"he"/"her"/
 * "his", since a capitalized pair is as often a group or course ("Bible Courses taught by …").
 */
const NAMED_CAREER = new RegExp(
  String.raw`${PERSON}\s+(?:has|had)\s+(?:also\s+)?(?:performed|trained|danced|competed|taught|coached|choreographed|studied\s+(?:ballet|dance|voice|piano|music|at))\b`,
  "g",
);
const GENDERED_PRONOUN = /\b(?:[Ss]he|[Hh]e|[Hh]er|[Hh]is)\b/;
/**
 * One person's career or life told in the first person (an officer's bio on the Ballroom Dance
 * Club's About: "Professionally, I've led UX design at companies like Amazon … Outside of
 * ballroom, you'll find me at the Harvard Innovation Labs … (I'm easily bribed with sweets)"):
 * "I've led/worked/been …", "you'll find me …", "I'm easily …", "Professionally, I …", or "my" with a
 * career or free-time word. A club's "we" ("We've led Harvard dance since 1960") never matches.
 * Case-sensitive "I" on purpose (1.16.49, g26).
 */
const FIRST_PERSON_LIFE = new RegExp(
  String.raw`\bI(?:['’]ve| have)\s+(?:also\s+|previously\s+|recently\s+|always\s+)?(?:led|worked|been|served|managed|interned|spent|taught|coached|studied|founded|co-founded|built|launched|designed|danced|competed|performed|trained|grown up|lived)\b` +
    String.raw`|\b(?:you['’]ll|you will|you can|you['’]d)\s+(?:usually\s+|often\s+|probably\s+|also\s+)?find me\b` +
    String.raw`|\b(?:I['’]m|I am)\s+easily\b` +
    String.raw`|\b[Pp]rofessionally,\s+I\b` +
    String.raw`|\b[Mm]y\s+(?:[a-z]+\s+)?(?:career|day job|internships?|work experience|professional (?:life|background|experience)|résumé|resume|employer|free time|spare time|hobbies)\b`,
);

/**
 * A member's or instructor's bio instead of a description (the Ballroom Dance Club's About was a
 * captain's "Hi! I'm Mikayla, a sophomore in Pfoho …" and an instructor's "Tola's dance journey
 * included …"): a first-person self-introduction, a class with a house or concentration, a named
 * person's journey or career, or a gendered career clause ("she competes in …"). A name inside
 * the club's own name ("Phillips Brooks House Association") never counts. Part of
 * `namesPeopleProblem`, so it guards descriptions, missions, summaries and activities. PURE.
 */
export function personalBioProblem(text: string, ownNames: readonly string[] = []): QuoteProblem | null {
  const own = ownNames.filter(Boolean);
  const intro = text.match(SELF_INTRO)?.[0];
  if (intro) return { check: "names_people", why: `a person introducing themselves ("${intro.trim().slice(0, 40)}")` };
  const house = text.match(CLASS_HOUSE)?.[0];
  if (house) return { check: "names_people", why: `a person's class and house ("${house.slice(0, 50)}")` };
  for (const m of text.matchAll(POSSESSIVE_BIO)) {
    const name = m[1] ?? "";
    if (NOT_A_PERSON_WORD(name) || ORG_WORD.test(name) || own.some((n) => n.includes(name))) continue;
    return { check: "names_people", why: `a person's bio ("${m[0]}")` };
  }
  const named = GENDERED_PRONOUN.test(text) ? personIn(NAMED_CAREER, text, own) : null;
  if (named && !ORG_WORD.test(named)) return { check: "names_people", why: `a person's career ("${named}")` };
  const career = text.match(GENDERED_CAREER)?.[0];
  if (career) return { check: "names_people", why: `a person's bio ("${career}")` };
  const life = text.match(FIRST_PERSON_LIFE)?.[0];
  if (life) return { check: "names_people", why: `a person's own career or life ("${life.trim().slice(0, 40)}")` };
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

/** The first sentence, also past a closing quote or bracket ('… results." (All …'). */
function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.!?]["”’')\]]?)\s+(?=[A-Z“"(])/)[0] ?? "";
}

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
  /\b(?:do not|don['’]t|please do not) (?:purchase|buy|order)\b|\bpurchase (?:these|this|it|them|a membership) (?:from|on|through) our (?:site|store|shop|website)\b|\b(?:full |partial )?refunds? (?:will be provided|policy|requests?)\b/i;
/**
 * A warning about impostors or scams ("HMMT does not partner with any organizations connected to
 * competing teams. Any non-HMMT person or group claiming to represent HMMT is untruthful…"):
 * it says who the club isn't, not what it is (round 6).
 */
const SCAM_WARNING =
  /\b(?:does not|do not|doesn['’]t|don['’]t|never) (?:partner|affiliate|work) with\b|\bclaim(?:s|ing)? to (?:represent|be affiliated with|be from)\b|\bscam(?:s|mers?)?\b|\bphishing\b|\bfraudulent\b|\bimpersonat\w+/i;
/**
 * Cloudflare's email obfuscation leaves "[email protected]" where an address was: the text was read
 * from the page's HTML without the script that restores it, so it isn't text a reader sees.
 */
const EMAIL_ARTIFACT = /\[email[\s\u00a0]*protected\]/i;
/**
 * News that something this term has started, read from the first sentence ("Classes for the
 * semester have also begun!", the Ballroom Dance Club's About; 1.16.49, g26).
 */
const HAS_BEGUN =
  /\b(?:classes|lessons|practices|rehearsals|meetings|sessions|workshops|tryouts|auditions|registration|applications|recruitment|recruiting|comps?|the (?:semester|season|term|year)|our (?:semester|season))\b[^.!?]{0,40}?\b(?:have|has)\s+(?:also\s+|officially\s+|now\s+|just\s+|finally\s+)?(?:begun|started|resumed|kicked off|commenced)\b/i;
/** "Want to join? Check our classes page …": a pointer to another page, not About text. */
const WANT_TO_JOIN_POINTER =
  /\b(?:want|interested|looking) (?:to join|in joining)\b[^.!?]{0,20}[?!.]\s*(?:then\s+)?(?:check|visit|see|head (?:over )?to|go to|take a look at)\s+(?:out\s+)?our\b[^.!?]{0,40}\bpage\b/i;
export function noticeProblem(text: string): QuoteProblem | null {
  const open = text.match(NOTICE_OPENER)?.[0];
  if (open) return { check: "notice", why: `a notice to visitors ("${open.trim().slice(0, 40)}")` };
  const begun = firstSentence(text).match(HAS_BEGUN)?.[0];
  if (begun) return { check: "notice", why: `news that something has started ("${begun.slice(0, 50)}")` };
  const pointer = text.match(WANT_TO_JOIN_POINTER)?.[0];
  if (pointer && !CLUB_SELF_DESCRIPTION.test(text))
    return { check: "notice", why: `points visitors to another page ("${pointer.slice(0, 50)}")` };
  const shop = text.match(SHOP_TALK)?.[0];
  if (shop) return { check: "notice", why: `shop or purchase text ("${shop}")` };
  const scam = text.match(SCAM_WARNING)?.[0];
  if (scam) return { check: "notice", why: `a warning about impostors or scams ("${scam}")` };
  const hidden = text.match(EMAIL_ARTIFACT)?.[0];
  if (hidden) return { check: "notice", why: `carries an obfuscated email address ("${hidden}")` };
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

/**
 * An announcement of one event or piece of news ("The Harvard Undergraduate Venture Capital Group
 * (VCG) is excited to announce our second … High School Pitch Competition!", "Save the date",
 * "Registration is now open"), read from the first sentence only: a description may mention an
 * event later on. Round 5 (VCG's mission). PURE.
 */
const ANNOUNCEMENT_LEAD =
  /^\W*(?:save the date|stay tuned|come (?:to|see) our)\b|\b(?:is|are|we(?:'|’)re|we are|I am|I['’]m) (?:so |very |super |incredibly )?(?:excited|thrilled|delighted|pleased|proud|happy) to (?:announce|welcome|host|present|share|introduce|invite)\b|\bregistration is now (?:open|live)\b|\bregistration is (?:open|live)\b(?! to\b)|\bregistrations? (?:for|to)\b[^.!?]{0,160}?\b(?:is|are) (?:now (?:live|open)\b|live\b|open\b(?! to\b))|\btickets (?:are|can be) (?:now )?(?:available|purchased|on sale)\b/i;
export function announcementProblem(text: string): QuoteProblem | null {
  const first = text.trim().split(/(?<=[.!?])\s+(?=[A-Z"“])/)[0] ?? "";
  const hit = first.match(ANNOUNCEMENT_LEAD)?.[0];
  if (hit) return { check: "announcement", why: `announces an event or news ("${hit.trim().slice(0, 60)}")` };
  return null;
}

/**
 * A notice asking visitors to follow the club online ("Stay up to date with the team and our
 * events by following us on social media. We're active on both Instagram and Facebook…"): it
 * says where to find the club, not what it is. Round 5 (the Ballroom team's About). PURE.
 */
const FOLLOW_LEAD =
  /^\W*(?:stay (?:up[- ]to[- ]date|updated|connected|in the loop|tuned)|keep up(?: to date)? with|(?:be sure to |make sure to |don['’]t forget to )?follow us\b|find us on|connect with us on)/i;
const FOLLOW_US =
  /\bfollow(?:ing)? us (?:on|at)\b[^.!?]{0,40}\b(?:social media|instagram|facebook|twitter|tiktok|linkedin|youtube|socials)\b/i;
const CHANNEL_WORD = /\b(?:social media|instagram|facebook|newsletter|mailing list|socials|listserv)\b/i;
export function socialFollowProblem(text: string): QuoteProblem | null {
  const t = text.trim();
  const lead = t.match(FOLLOW_LEAD)?.[0];
  if (lead && (FOLLOW_US.test(t) || CHANNEL_WORD.test(t)))
    return { check: "social_follow", why: `asks visitors to follow the club ("${lead.trim().slice(0, 40)}")` };
  // A short text that is mostly the invitation ("Follow us on Instagram @x for updates!").
  if (t.length <= 220 && FOLLOW_US.test(t) && !/\b(?:is|are) (?:a|an|the)\b/i.test(t))
    return { check: "social_follow", why: "a request to follow the club on social media" };
  return null;
}

/**
 * A request for money, not a description (the Ballroom Dance Club's "Thanks to the generous
 * support of our alumni, HBDT continues to thrive … You can donate through the Harvard Athletics
 * Giving Form"): an ask to donate or give, or a thank-you to donors that opens the text. A club
 * that raises money for others ("we donate to local food banks") passes. Round 6. PURE.
 */
const DONATION_ASK =
  /\bdonate (?:through|via|here|online|today|now|using|to (?:us|the (?:club|team|group|society)))\b|\b(?:you can|please|please consider|consider) (?:donat(?:e|ing)|giving|making a (?:gift|donation))\b|\byour (?:generous |tax[- ]deductible )?(?:gift|donation)s?\b|\bmake a (?:gift|donation)\b|\bgiving (?:form|page|link)\b|\b(?:willing|able)(?: and able)? to (?:contribute|donate|give)\b|\btax[- ]deductible\b/i;
const DONOR_THANKS =
  /^\W*(?:thanks|thank you) to (?:the )?(?:(?:generous|continued|ongoing) )*(?:support|generosity|gifts?|donations?) of (?:our )?(?:alumni|donors|supporters|friends|parents|sponsors)\b/i;
export function donationProblem(text: string): QuoteProblem | null {
  const hit = text.match(DONOR_THANKS)?.[0] ?? text.match(DONATION_ASK)?.[0];
  if (hit) return { check: "donation", why: `asks for donations ("${hit.trim().slice(0, 50)}")` };
  return null;
}

/**
 * A booking or hiring pitch: "To book us for your next event, use the booking form linked
 * below" (the Krokodiloes' home page, 2026-10-13). It sells the group's performances to
 * outsiders; it isn't what the club is. PURE.
 */
const BOOKING_PITCH =
  /\b(?:to )?(?:book|hire) (?:us|the group|the band|the (?:kroks|ensemble|choir|troupe|team))\b|\bbooking (?:form|inquir(?:y|ies)|requests?|page)\b|\bfor (?:bookings?|hiring) (?:inquir(?:y|ies)|requests?|information)\b|\binterested in (?:booking|hiring)\b/i;
export function bookingPitchProblem(text: string): QuoteProblem | null {
  const hit = text.match(BOOKING_PITCH)?.[0];
  // Only when the pitch is half the text or more: a seven-sentence About that ends "…or book us
  // today and we'll come to you!" (the Opportunes) still describes the group.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z“"‘'])/).filter((s) => s.trim()).length;
  return hit && sentences <= 2 ? { check: "booking_pitch", why: `a booking pitch to outsiders ("${hit}")` } : null;
}

/** The About-text rules that need no club context; the first problem found. PURE. */
export function aboutTextProblem(text: string): QuoteProblem | null {
  return (
    welcomeLetterProblem(text) ??
    noticeProblem(text) ??
    eventRecapProblem(text) ??
    announcementProblem(text) ??
    socialFollowProblem(text) ??
    donationProblem(text) ??
    bookingPitchProblem(text)
  );
}

// --- Recruiting seasons: shows and production positions (president's check, 2026-10-13) -----------

/** "Show Season: February 5 – March 19", "our concert season runs in the spring". */
const PERFORMANCE_SEASON =
  /\b(?:show|performance|concert|production|competition|racing|game|playing|touring|tour) seasons?\b|\b(?:shows?|performances?|concerts?|productions?|tours?)\b[^.!?;]{0,40}\b(?:run|runs|are held|is held|take place|takes place|open|opens|premieres?)\b[^.!?;]{0,25}\b(?:every|each|in the|during the) (?:fall|autumn|spring|winter|summer)\b/i;
/**
 * Comps for named production positions: "Script, lyrics, composer, and choreographer comps are
 * all held in the Spring. The Poster comp is held in the Fall." (the Theatricals' Creative Team,
 * whose cast, band and tech audition in September). When writers or poster designers are
 * picked isn't when the club recruits members.
 */
const POSITION_COMP =
  /\b(?:script|lyrics?|lyricists?|composers?|choreograph(?:er|ers|y)|poster|costume|set design|lighting design|playwrights?|writers?|directors?|producers?)\b[^.!?]{0,60}\bcomps?\b/i;

/**
 * Why a sentence's season isn't when the club recruits, or null: a show, concert or competition
 * season, or the comp for named production positions. Shared by the deterministic extractor and
 * LLM grounding (1.16.46, g23). PURE.
 */
export function seasonScopeProblem(sentence: string): QuoteProblem | null {
  const show = sentence.match(PERFORMANCE_SEASON)?.[0];
  if (show) return { check: "performance_season", why: `a performance season, not recruiting ("${show}")` };
  const position = sentence.match(POSITION_COMP)?.[0];
  if (position)
    return { check: "position_comp", why: `a comp for named production positions, not members ("${position}")` };
  return null;
}

// --- Stitched text and menu labels (president's check, 2026-10-13) -----------------------------------

const TEXT_STOP = new Set(
  "a an and the of for to in on at by with our their its we us they is are be as from that this these those it or into which who".split(
    " ",
  ),
);
const textWords = (t: string) =>
  t
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/'s$/, "").replace(/s$/, ""))
    .filter((w) => w.length >= 3 && !TEXT_STOP.has(w));

/**
 * A value stitched from two sentences of its quote: "As the only daily newspaper of Harvard
 * University and the City of Cambridge, to serve readers ethically" from "…we have a unique
 * obligation to our readers. To serve them ethically, we aim to:" (the Crimson's mission).
 * Words the value takes from a second sentence (two or more no single sentence has) mean it
 * says something none of the club's sentences says. PURE.
 */
export function stitchedTextProblem(value: string, quote: string): QuoteProblem | null {
  const sentences = quote
    .split(/(?<=[.!?:;])\s+(?=[A-Z“"‘'(])/)
    .map((s) => new Set(textWords(s)))
    .filter((s) => s.size > 0);
  if (sentences.length < 2) return null;
  const all = new Set(sentences.flatMap((s) => [...s]));
  const words = [...new Set(textWords(value))].filter((w) => all.has(w));
  if (words.length < 4) return null;
  const best = Math.min(...sentences.map((s) => words.filter((w) => !s.has(w)).length));
  return best >= 2
    ? { check: "stitched_text", why: `joins words from more than one sentence of its quote ("${value.slice(0, 60)}")` }
    : null;
}

/**
 * A site's menu read as activities: "News", "Opinion", "Blog" from "News ·Opinion ·Arts ·Blog
 * ·Magazine ·Multimedia ·Sports" (the Crimson's header): three or more short items between
 * menu separators. An activity says what members do. A bare label alone ("Podcasts") can be a
 * real bullet of a "What we do" list, so it isn't judged here. PURE.
 */
const MENU_SEPARATORS = /\s[·•|]\s?|\s?[·•|]\s/g;
export function navLabelActivityProblem(value: string, quote: string): QuoteProblem | null {
  const items = quote
    .trim()
    .split(MENU_SEPARATORS)
    .map((s) => s.trim())
    .filter(Boolean);
  const menu = items.length >= 3 && items.every((s) => s.split(/\s+/).length <= 3 && !/[.!?]$/.test(s));
  return menu ? { check: "nav_label", why: `a menu label, not an activity ("${value.slice(0, 40)}")` } : null;
}

// --- Recruiting stage kinds (student testing round 5) --------------------------------------------

/** Words a label must use before a stage is shown as that specific kind. */
const SPECIFIC_INTERVIEW: Partial<Record<StageKind, RegExp>> = {
  case_interview: /\bcase\b/i,
  technical_interview: /\b(?:technical|coding|programming|tech)\b/i,
};

/**
 * A stage's kind, no more specific than its label: an LLM read HUCG's "Second Round Interview"
 * (a short presentation on a mock business problem) as a case interview. A case or technical
 * interview whose label doesn't say so is an interview. PURE.
 */
export function stageKindFromLabel(kind: StageKind, label: string | null | undefined): StageKind {
  const needs = SPECIFIC_INTERVIEW[kind];
  if (needs && !needs.test(label ?? "")) return "interview";
  return kind;
}

// --- Audition instructions aren't experience requirements (student testing round 5) -------------

const AUDITION_PREP =
  /\b(?:prepare[ds]?|preparing|monologues?|sight[- ]?read(?:ing)?|scales|excerpts?|contrasting (?:pieces|selections|works)|repertoire|happy birthday|callbacks?)\b/i;
const EXPERIENCE_WORD =
  /\b(?:experience[ds]?|beginners?|novices?|background|never (?:sung|played|danced|acted)|must (?:play|sing|have|know|be able)|years? of)\b/i;

/**
 * What to bring to an audition ("Prepare two contrasting pieces …; no sight reading, scales …",
 * "No monologue needed; prepare 1-2 minutes of a song") says how the audition runs, not what
 * experience joining needs (HRO's Experience row, round 5). Text that also speaks of experience
 * ("No experience needed; prepare a short song") passes. PURE.
 */
export function auditionPrepProblem(text: string): QuoteProblem | null {
  const hit = text.match(AUDITION_PREP)?.[0];
  if (!hit || EXPERIENCE_WORD.test(text)) return null;
  return { check: "audition_prep", why: `audition instructions, not an experience requirement ("${hit}")` };
}

// --- History and archive pages, and facts about the past (2026-10-13) ------------------------------

/**
 * A path segment that marks a page about the club's past: "/history", "/our-history",
 * "/history.php", "/history-of-the-club", "/archives", "/past-boards", "/past-events",
 * "/in-memoriam". A club's own folder or site name never counts ("/history-club" is a club, so
 * only the exact forms below match).
 */
const HISTORY_SEGMENT =
  /^(?:(?:our|club|team|group|the|a|brief|short|full)-)*(?:history|histories|archives?|heritage|in-memoriam|timeline|past-(?:boards?|members|officers|seasons|productions|shows|projects|events|concerts|leadership))(?:-(?:of-[a-z0-9-]+|page))?$/;
/** A path segment for the club's alumni: "/alumni", "/alumni-network", "/alums". */
const ALUMNI_SEGMENT =
  /^(?:(?:our|club|team|the)-)*(?:alumni|alumnae|alums)(?:-(?:network|directory|page|board|relations))?$/;
/** A title or heading segment that is the same: "History", "Our History", "A Brief History of …". */
const HISTORY_TITLE =
  /^(?:(?:a\s+)?(?:brief|short)\s+)?(?:(?:our|club|team|the)\s+)?(?:history|archives?|heritage|in memoriam|timeline)$|^(?:a\s+)?(?:(?:brief|short)\s+)?history of\b/i;
const ALUMNI_TITLE = /^(?:(?:our|club|team|the)\s+)?(?:alumni|alumnae|alums)$/i;

/** Path segments that are one group's own site on a shared host (sites.harvard.edu/<club>, sites.google.com/view/<club>). */
function siteFolderSegments(u: URL): number {
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "sites.harvard.edu") return 1;
  if (host === "sites.google.com") return u.pathname.startsWith("/view/") ? 2 : 1;
  return 0;
}

/**
 * Whether a page is about the club's past (`history_page`: history, archive, past events) or its
 * alumni (`alumni_page`), by its URL path or its title / main heading. A history page tells what
 * the club was: the Wireless Club's gave a 1909 professor as its About text and "averaged about 25
 * members" (its early years) as its size; STAHR's gave a note about digitizing the observatory
 * logbooks. Many clubs' history pages also say what the club is today ("Today's Harvard Glee Club
 * consists of about 70 members", "currently has 22 members"), so what such a page may give is
 * judged claim by claim (`historyClaimProblem`). PURE.
 */
export function historyPageProblem(url: string, ...titles: (string | null | undefined)[]): QuoteProblem | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean).slice(siteFolderSegments(u));
    for (const raw of segments) {
      let seg = raw;
      try {
        seg = decodeURIComponent(raw);
      } catch {
        // keep the raw segment
      }
      seg = seg
        .toLowerCase()
        .replace(/\.(?:php|html?|aspx?|jsp)$/, "")
        .replace(/[_\s]+/g, "-");
      if (ALUMNI_SEGMENT.test(seg)) return { check: "alumni_page", why: `an alumni page (${u.pathname})` };
      if (HISTORY_SEGMENT.test(seg)) return { check: "history_page", why: `a history or archive page (${u.pathname})` };
    }
  } catch {
    // not a URL: judge the titles alone
  }
  for (const title of titles) {
    if (!title) continue;
    const parts = title.split(/\s*[|–—:·•»]\s*|\s+-\s+/).map((s) => s.trim());
    const alumni = parts.find((s) => ALUMNI_TITLE.test(s));
    if (alumni) return { check: "alumni_page", why: `an alumni page ("${alumni}")` };
    const hit = parts.find((s) => HISTORY_TITLE.test(s));
    if (hit) return { check: "history_page", why: `a history or archive page ("${hit}")` };
  }
  return null;
}

/** What the club is: About text, mission, one-liners. */
const ABOUT_FIELDS: ReadonlySet<string> = new Set([
  "club.short_description",
  "club.long_description",
  "club.mission",
  "club.summary",
]);
/** Facts that must be current: size, who may join, dues, time, how to join, when it recruits. */
const CURRENT_FACT_FIELDS: ReadonlySet<string> = new Set([
  "club.member_count",
  "club.freshmen_eligible",
  "club.eligible_classes",
  "club.eligibility_note",
  "club.experience_required",
  "club.dues",
  "club.hours_per_week",
  "club.meeting_frequency",
  "club.join_mode",
  "club.recruiting_seasons",
  "club.self_described_selectivity",
]);

/** A finite past verb opening a narrative: "Pierce was …", "Rejection gave birth to …". */
const PAST_FINITE =
  /\b(?:was|were|had|became|began|gave|grew|drafted|did|averaged|acquired|numbered|operated|purchased|bought|received|compiled)\b/i;
/**
 * Text that cites a university archive as its source ("All quotations … are taken from the Harvard
 * University Archives"): archival history, not what the club is now (1.16.49, g26). "… records
 * for the University Archives" only names it.
 */
const CITES_ARCHIVES =
  /\b(?:taken|quoted|drawn|excerpted|reproduced|adapted|derived|courtesy)\s+(?:of|from)\s+(?:the\s+)?(?:Harvard\s+)?University\s+Archives\b|\b(?:source|sources|credit|image)\s*:\s*(?:the\s+)?(?:Harvard\s+)?University\s+Archives\b|\bquotations?\b[^.!?]{0,80}\bUniversity\s+Archives\b/i;

/**
 * Whether text tells the club's past rather than what it is: its first sentence has a finite past
 * verb and nothing in the present ("Pierce was the Rumford Professor …", "Completed in early 2020,
 * HUBS drafted a bill …", "It was not easy for Black students …"). "The Radcliffe Choral Society,
 * founded in 1899, is a treble choral ensemble" and "For 30 years, we have made it our mission …"
 * pass. PURE.
 */
export function pastNarrativeProblem(text: string): QuoteProblem | null {
  // A quoted phrase or a bracketed note isn't the sentence's own tense.
  const first = firstSentence(text)
    .replace(/[“"][^”"]*[”"]/g, " ")
    .replace(/\([^)]*\)/g, " ");
  if (!PAST_FINITE.test(first) || PRESENT_MARK.test(first)) return null;
  // Past verbs and a cited university archive: archival history even beside a present verb (the
  // Wireless Club's "The Club averaged about 25 members and acquired …", 1.16.49).
  if (CITES_ARCHIVES.test(text))
    return { check: "past_narrative", why: `archival history ("${first.trim().slice(0, 60)}")` };
  if (PRESENT_VERB.test(first)) return null;
  return { check: "past_narrative", why: `tells the club's past ("${first.slice(0, 60)}")` };
}

/**
 * Whether a claim read on a history or alumni page (`page`, from `historyPageProblem`) may stand,
 * by its field and quote. An alumni page speaks about alumni: no About text, activities or current
 * facts from it. A history page gives a current fact (size, eligibility, dues, hours, join modes,
 * seasons) only from a sentence that says it is current ("currently has 22 members", "Today's …
 * consists of about 70 members", "is … open to any student"), About text only when it isn't a story
 * of the past (`pastNarrativeProblem`), and never a recruiting round. Its activities (traditions,
 * tours), links, former names and sponsors stand. PURE.
 */
export function historyClaimProblem(fieldKey: string, quote: string, page: QuoteProblem | null): QuoteProblem | null {
  if (!page) return null;
  if (fieldKey.startsWith("cycle.")) return { check: page.check, why: `${page.why}: no recruiting round from it` };
  const current = CURRENT_FACT_FIELDS.has(fieldKey);
  const about = ABOUT_FIELDS.has(fieldKey);
  if (page.check === "alumni_page")
    return current || about || fieldKey === "club.activity" ? { check: page.check, why: page.why } : null;
  if (current && !PRESENT_VERB.test(quote) && !PRESENT_MARK.test(quote))
    return { check: page.check, why: `${page.why}, and the sentence doesn't say it is current` };
  const past = about ? pastNarrativeProblem(quote) : null;
  return past ? { check: page.check, why: `${page.why}: ${past.why}` } : null;
}

/** Words that put a sentence's fact in the past, whatever the number. */
const PAST_TIME =
  /\b(?:in (?:its|the club['’]s|the group['’]s|our|their) (?:early|first|founding|initial|first few) (?:years?|days|decades?|semesters?)|in the early days|at that time|at the time\b(?! of\b)|(?:we|it|they|there|the (?:club|group|team|society|station))\s+used to|back then|in those days|at (?:its|their|our) (?:peak|height)|in (?:its|their|our) heyday|once (?:had|numbered|boasted|counted)|in (?:the )?(?:nineteenth|twentieth|19th|20th) century)\b/i;
/** A decade: "in the 1920s", "during the 2000s". */
const DECADE =
  /\b(?:in|during|through(?:out)?|by)\s+the\s+(?:early\s+|late\s+|mid-?\s*)?((?:18|19|20)[0-9]0)['’]?s\b/gi;
/** A year as the time of the fact: "In 1985, …", "by 2012 the club had …". */
const FACT_YEAR = /\b(?:in|by|during|circa|around|as of|as late as|until)\s+((?:18|19|20)[0-9]{2})\b/gi;
/** "Founded in 1909", "established around 1950": a year that dates the club, not the fact. */
const DATES_THE_CLUB =
  /\b(?:founded|established|started|created|formed|chartered|began|begun|organized|organised|incorporated|recognized|launched|est\.?)\s*$/i;
/** A simple-past verb right before the number: "averaged about 25", "had 40", "numbered over 100". */
const PAST_VERB_BEFORE =
  /\b(?:averaged|numbered|boasted|had|grew to|peaked at|counted|totall?ed|reached|was|were)\b[^.;!?\d]{0,25}$/i;
/** "now", "currently", "today": the clause is about the present. */
const PRESENT_MARK = /\b(?:now|currently|today|this (?:year|semester|fall|spring)|presently)\b/i;

/**
 * Whether a sentence states its fact about the club's past, not now: "in its early years",
 * "in the 1920s", "used to", "at the time", "In 1985, …" (a year more than five years before
 * `ref`), or a simple past verb on the number ("The Club averaged about 25 members"). Such a
 * sentence never gives a member count, hours or dues. "Founded in 1909, the club has over 100
 * active members" passes: the year dates the club, and the count is in the present. `nums` are the
 * fact's numbers (empty when it has none, e.g. "no dues"). PURE.
 */
export function pastFactProblem(sentence: string, nums: readonly number[], ref: Date): QuoteProblem | null {
  const past = sentence.match(PAST_TIME)?.[0];
  if (past && !PRESENT_MARK.test(sentence)) return { check: "past_fact", why: `about the club's past ("${past}")` };
  const cutoff = ref.getUTCFullYear() - 5;
  for (const m of sentence.matchAll(DECADE)) {
    if (Number(m[1]) + 9 < cutoff) return { check: "past_fact", why: `about the club's past ("${m[0]}")` };
  }
  // The clause each number is in: "Founded in 1909, the club now has 100" is about the present.
  const clauses = nums.flatMap((n) => {
    const w = around(sentence, n);
    return w ? [{ n, clause: w.before.split(/[,;:]/).pop() ?? w.before }] : [];
  });
  const presentFact = clauses.length
    ? clauses.every((c) => PRESENT_VERB.test(c.clause) || PRESENT_MARK.test(c.clause))
    : PRESENT_VERB.test(sentence);
  for (const m of sentence.matchAll(FACT_YEAR)) {
    const year = Number(m[1]);
    // "in 1909" is never itself the count; a year that dates the club, or a fact stated in the
    // present ("In 2015 we were featured …, and we have 60 members"), isn't the fact's time.
    if (year >= cutoff || nums.includes(year) || presentFact) continue;
    if (DATES_THE_CLUB.test(sentence.slice(0, m.index ?? 0))) continue;
    return { check: "past_fact", why: `states the fact as of ${year} ("${m[0]}")` };
  }
  // "In 2024, the club had 45 members": a recent dated figure is still current enough.
  const recent = [...sentence.matchAll(FACT_YEAR)].some((m) => Number(m[1]) >= cutoff && !nums.includes(Number(m[1])));
  if (recent) return null;
  for (const { n, clause } of clauses) {
    if (PRESENT_MARK.test(clause)) continue;
    const verb = clause.match(PAST_VERB_BEFORE)?.[0];
    if (verb) return { check: "past_fact", why: `a past figure ("${verb.trim()} ${n}")` };
  }
  return null;
}

/** A present-tense verb on the fact: "has over 100 members", "dues are $20", "members spend 3 hours". */
const PRESENT_VERB =
  /\b(?:has|have|is|are|boasts|includes|include|counts|numbers|welcomes|consists|comprises|spans|spend|spends|meets|meet|costs?|charges?|requires?|takes?)\b/i;

// --- About text that runs on into the club's history (persona round 8) ------------------------------

/** About text longer than this that turns to the club's past is cut before it. */
const LONG_ABOUT = 600;
/**
 * A sentence start inside About text: after . ! ? (and a closing quote or bracket), also where
 * page text glued two paragraphs together ("…community offers.When the Advocate…"). Not after
 * initials ("T.S. Eliot") or a title ("Mrs. Lowell"), and only before a capitalized word.
 */
const ABOUT_SENTENCE_START =
  /(?<!\b(?:Mrs|Ms|Mr|Dr|St|Prof|Jr|Sr|vs|No|Inc|approx|Sept?|Oct|Nov|Dec|Jan|Feb|Mar|Apr|Jun|Jul|Aug)[.!?])(?<=[a-z0-9]{2}[.!?][”"’)]?)\s*(?=[A-Z“"][a-z])/g;

/**
 * A long About paragraph that says what the club is and then tells its history ("The Harvard
 * Advocate, founded in 1866, is the oldest … literary magazine … A quarterly magazine, The
 * Advocate's mission is to publish … When the Advocate was founded, it adopted the motto …",
 * 1,800 characters of names and dates): the describing lead before its first sentence about the
 * past (`pastNarrativeProblem`), verbatim. Null when the text is short, never turns to the past,
 * or its lead is too short to stand as About text. PURE.
 */
export function aboutBeforeHistory(text: string): string | null {
  if (text.length <= LONG_ABOUT) return null;
  const starts = [0, ...[...text.matchAll(ABOUT_SENTENCE_START)].map((m) => m.index ?? 0)];
  for (let i = 1; i < starts.length; i++) {
    const sentence = text.slice(starts[i], starts[i + 1] ?? text.length);
    if (!pastNarrativeProblem(sentence)) continue;
    const lead = text.slice(0, starts[i]).trim();
    return lead.length >= 120 ? lead : null;
  }
  return null;
}

// --- Text whose subject is a person or an archival project (2026-10-13) -----------------------------

/** A title or role that makes the sentence's subject a person: "Pierce was the Rumford Professor of Physics". */
const PERSON_ROLE =
  /\b(?:professor|lecturer|dean|physicist|chemist|astronomer|scientist|engineer|inventor|mathematician|historian|curator|alumnus|alumna|graduate of|benefactor|donor)\b/i;
/** A capitalized name opening the text, then "was"/"is" + an article: "Pierce was the …", "Dr. Jane Doe is a …". */
const PERSON_OPENING = new RegExp(
  String.raw`^\W*(?:(?:Professor|Prof\.|Dr\.|Mr\.|Mrs\.|Ms\.|Sir|Dean)\s+)?(${NAME_WORD}(?:\s+[A-Z]\.)*(?:\s+${NAME_WORD}){0,2})\s*(?:\([^)]{0,30}\)\s*)?(?:was|is|served as|became)\s+(?:the|a|an|one of the)\b`,
);
/** A lifespan right after a name: "Jane Doe (1850–1920)". */
const LIFESPAN = new RegExp(
  String.raw`(${NAME_WORD})\s*\(\s*(?:b\.\s*)?(?:18|19)[0-9]{2}\s*[–-]\s*(?:18|19|20)[0-9]{2}\s*\)`,
);
/** Opening words that are never a person: the club, a place, a pronoun. */
const NOT_PERSON_OPENING =
  /^(?:Harvard|Radcliffe|Cambridge|Boston|The|This|That|It|We|Our|Its|Their|There|Here|Each|Every|Membership|Members|Students|Founded|Established)$/;
/** An archival or digitizing project: "we're digitizing all of our logbooks", "scanned PDFs". */
const ARCHIVE_WORD =
  /\b(?:digiti[sz](?:e|es|ed|ing|ation)|logbooks?|archival|finding aids?|scann(?:ed|ing)|transcrib(?:e|ed|ing)|PDFs?|microfilm|scrapbooks?)\b/gi;
/** A sentence that says what the club is or does. */
const CLUB_SELF_DESCRIPTION =
  /\b(?:we are|we['’]re (?:a|an|the)|is (?:a|an|the) (?:[\w-]+ ){0,4}(?:club|group|organi[sz]ation|society|team|community|ensemble|publication|association)|our (?:club|group|organi[sz]ation|society|mission))\b/i;

/**
 * Whether text meant as the club's description has a person or an archival project as its
 * subject, not the club: a history page's "Pierce was the Rumford Professor of Physics and
 * Director of the Crufts High Tension Laboratory, where the Club held meetings …" (the Wireless
 * Club), a lifespan after a name, or a note about digitizing records ("Our logbooks record all the
 * visitors … we're currently in the process of digitizing ALL of them … broken up into a few
 * PDFs", STAHR). A name inside the club's own name never counts, and text that also says what the
 * club is passes the archive rule. Complements `namesPeopleProblem` (class years, credits,
 * leaders, bios). PURE.
 */
export function archivalSubjectProblem(text: string, ownNames: readonly string[] = []): QuoteProblem | null {
  const own = ownNames.filter(Boolean);
  const first = text.trim().split(/(?<=[.!?])\s+(?=[A-Z“"])/)[0] ?? "";
  const opening = PERSON_OPENING.exec(first);
  const name = opening?.[1] ?? "";
  const firstWord = name.split(/\s+/)[0] ?? "";
  if (
    opening &&
    !NOT_PERSON_OPENING.test(firstWord) &&
    !NOT_A_PERSON_WORD(firstWord) &&
    !ORG_WORD.test(name) &&
    !own.some((n) => n.includes(name)) &&
    PERSON_ROLE.test(first)
  )
    return { check: "person_subject", why: `about a person, not the club ("${opening[0].trim().slice(0, 60)}")` };
  const life = LIFESPAN.exec(text);
  if (life && !own.some((n) => n.includes(life[1] ?? "")) && !NOT_A_PERSON_WORD(life[1] ?? ""))
    return { check: "person_subject", why: `about a person, not the club ("${life[0]}")` };
  const cited = text.match(CITES_ARCHIVES)?.[0];
  if (cited)
    return { check: "archive_project", why: `cites a university archive as its source ("${cited.slice(0, 60)}")` };
  const archive = new Set([...text.matchAll(ARCHIVE_WORD)].map((m) => m[0].toLowerCase().replace(/s$/, "")));
  if (archive.size >= 2 && !CLUB_SELF_DESCRIPTION.test(text))
    return { check: "archive_project", why: `about an archival project, not the club ("${[...archive].join(", ")}")` };
  return null;
}
