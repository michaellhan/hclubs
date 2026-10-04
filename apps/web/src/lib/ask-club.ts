/**
 * "Ask the club": a student's own question to a club whose page doesn't say how or when to
 * join, prefilled as an email or a short Instagram message. The student sends it from their
 * own inbox or account; nothing passes through hclubs. The question comes first; the line
 * pointing officers at /for-clubs is an aside, never a request.
 */

export type AskTopic = "how" | "when" | "time";

interface AskLink {
  kind: string;
  url: string;
  status: "verified" | "probable" | "unverified";
}

export interface AskPlan {
  /** The club's own address, best for a membership question. */
  email: string | null;
  /** The club's Instagram profile, only when it's confirmed as theirs. */
  instagram: string | null;
  /** What's missing, in the order the message asks it. */
  topics: AskTopic[];
}

const RANK = { verified: 0, probable: 1, unverified: 2 } as const;

// Which of a club's addresses a would-be member should write to: recruiting first, then a
// general inbox, and never a function's (alumni, sales, tutoring…) unless it's the only one.
const RECRUITING = /join|recruit|comp\b|tryout|audition|member/;
const GENERAL = /^(info|contact|hello|hi|board|team|exec|officers?|(co)?presidents?|chairs?|general|inquiries|enquiries)\b/;
const FUNCTION =
  /alumni|financ|treasur|sales|order|tech|webmaster|support|tour|tutor|event|business|marketing|press|media|communicat|publicity|editor|ads?\b|advertis|donat|sponsor|develop|academic|ticket|booking|archive/;

function addressRank(address: string): number {
  const local = address.split("@")[0]?.toLowerCase() ?? "";
  if (RECRUITING.test(local)) return 0;
  if (GENERAL.test(local)) return 1;
  if (FUNCTION.test(local)) return 3;
  return 2;
}

/**
 * Whether to offer "Ask the club", and through which channels. Only when how or when to join
 * is unknown (or the page is a bare name): time commitment alone is unknown for nearly every
 * club, so it rides along as a question but never triggers the offer. Only channels tied to
 * the club (verified or probable): an address or account found by name alone may not be
 * theirs. Personal addresses never reach here (publicProfile drops them). PURE.
 */
export function askClubPlan(input: {
  links: readonly AskLink[];
  howKnown: boolean;
  whenKnown: boolean;
  timeKnown: boolean;
  sparse: boolean;
}): AskPlan | null {
  if (input.howKnown && input.whenKnown && !input.sparse) return null;
  const own = input.links.filter((l) => l.status !== "unverified");
  const addresses = own
    .filter((l) => l.kind === "email")
    .map((l) => ({ address: l.url.replace(/^mailto:/i, "").split("?")[0]?.trim() ?? "", status: l.status }))
    .filter((e) => e.address.includes("@"));
  // Ties: the domain most of its addresses share (hsa.net over a subsidiary's groupgear.com),
  // then the plainest inbox (harvardcollegeopera@ over belonging.harvardcollegeopera@).
  const domain = (a: string) => a.split("@")[1]?.toLowerCase() ?? "";
  const perDomain = new Map<string, number>();
  for (const e of addresses) perDomain.set(domain(e.address), (perDomain.get(domain(e.address)) ?? 0) + 1);
  const email =
    addresses.sort(
      (a, b) =>
        addressRank(a.address) - addressRank(b.address) ||
        (perDomain.get(domain(b.address)) ?? 0) - (perDomain.get(domain(a.address)) ?? 0) ||
        a.address.indexOf("@") - b.address.indexOf("@") ||
        RANK[a.status] - RANK[b.status],
    )[0]?.address ?? null;
  const instagram =
    own.filter((l) => l.kind === "instagram").sort((a, b) => RANK[a.status] - RANK[b.status])[0]?.url ?? null;
  if (!email && !instagram) return null;
  const topics: AskTopic[] = [];
  if (!input.howKnown) topics.push("how");
  if (!input.whenKnown) topics.push("when");
  if (!input.timeKnown) topics.push("time");
  // A bare page with how/when known still asks the basics.
  if (!topics.length) topics.push("how", "when");
  return { email, instagram, topics };
}

const MISSING: Record<AskTopic, string> = {
  how: "how to join",
  when: "your recruiting timeline",
  time: "the weekly time commitment",
};

const QUESTION: Record<AskTopic, string> = {
  how: "how new members join (is there an application, comp or audition?)",
  when: "when your info sessions or deadlines are this semester",
  time: "about how many hours a week it takes",
};

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}

function and(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** The prefilled email: subject and body. `site` is the public origin, e.g. https://hclubs.app. PURE. */
export function askEmail(
  club: { name: string; slug: string },
  topics: readonly AskTopic[],
  site: string,
): { subject: string; body: string } {
  const page = `${site}/clubs/${club.slug}/`;
  return {
    subject: `Question about joining ${club.name}`,
    body: [
      `Hi ${club.name} team,`,
      "",
      `I'm interested in joining ${club.name} this semester, but I couldn't find ${list(topics.map((t) => MISSING[t]))} on hclubs (${page}).`,
      "",
      `Could you let me know ${and(topics.map((t) => QUESTION[t]))}?`,
      "",
      `(If it's useful, you can also add these details to your page at ${site}/for-clubs/?club=${club.slug} so other students can find them.)`,
      "",
      "Thanks!",
      "[Your name]",
    ].join("\n"),
  };
}

const SHORT: Record<AskTopic, string> = {
  how: "how to join",
  when: "when your deadlines are",
  time: "how much time it takes each week",
};

/** A two-sentence note to paste into an Instagram DM. PURE. */
export function askDmText(club: { name: string; slug: string }, topics: readonly AskTopic[], site: string): string {
  const host = site.replace(/^https?:\/\//, "");
  return (
    `Hi! I'm interested in joining ${club.name} this semester but couldn't find ${list(topics.map((t) => MISSING[t]))} on ${host}/clubs/${club.slug}. ` +
    `Could you tell me ${and(topics.map((t) => SHORT[t]))}?`
  );
}
