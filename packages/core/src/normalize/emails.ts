import { normalizeName } from "./names";

/**
 * Which email addresses may be published (CLAUDE.md §4, §21): a club's role addresses
 * ("info@", "board@", "harvardchessclub@gmail.com"), never a person's ("jane.doe@…",
 * "JaneDoe@…", "kit@pbha.org"), and never template junk ("info@mysite.com"). Addresses
 * are kept only when the local part shows it belongs to the club or a role. PURE.
 */

const ROLE_WORDS = [
  "info",
  "contact",
  "hello",
  "hi",
  "team",
  "board",
  "exec",
  "officers",
  "president",
  "presidents",
  "copresidents",
  "chair",
  "chairs",
  "secretary",
  "treasurer",
  "manager",
  "management",
  "admin",
  "office",
  "inquiries",
  "enquiries",
  "general",
  "mail",
  "email",
  "help",
  "support",
  "business",
  "finance",
  "events",
  "membership",
  "members",
  "join",
  "recruiting",
  "recruitment",
  "comp",
  "tryouts",
  "auditions",
  "publicity",
  "communications",
  "marketing",
  "outreach",
  "media",
  "press",
  "news",
  "editor",
  "editors",
  // A publication's editorial board ("masthead@hulr.org").
  "masthead",
  "editorinchief",
  "webmaster",
  "web",
  "tech",
  "design",
  "operations",
  "programming",
  "alumni",
  "sales",
  "orders",
  "tickets",
  "tour",
  "tours",
  "music",
  "archives",
  "academics",
  "volunteer",
  "donation",
  "donations",
  "official",
  "club",
  "society",
  "group",
  "harvard",
  "radcliffe",
  "crimson",
  "undergrad",
  "list",
  "subscribe",
  "producers",
  "director",
  "directors",
  "compliance",
  "social",
  "sports",
  "life",
  "wellbeing",
  "being",
  "residential",
  "extracurriculars",
  "corporate",
  "faculty",
  "mentorship",
  "tutoring",
  "academies",
  "distribution",
  "cleaners",
  "crisis",
  "ecosoc",
  "partnerships",
  "sponsorship",
  "development",
  "programs",
  "conference",
  "registration",
  "delegates",
  "hq",
] as const;

const PLACEHOLDER_DOMAINS =
  /(^|\.)(example\.(com|org|net)|mysite\.com|yoursite\.com|domain\.com|email\.com|yourdomain\.com|test)$/i;

/** Distinctive lowercase tokens (4+ letters) of a club's names and acronyms. */
function clubTokens(names: readonly string[]): string[] {
  // Initials too: "hshs" for Harvard Square Homeless Shelter.
  const initials = names.map((n) =>
    normalizeName(n)
      .split(" ")
      .filter((w) => w && !/^pbha'?s?$/.test(w))
      .map((w) => w[0])
      .join(""),
  );
  const generic = new Set([
    "harvard",
    "college",
    "undergraduate",
    "club",
    "society",
    "association",
    "the",
    "and",
    "for",
  ]);
  return [
    ...new Set(
      names
        .flatMap((n) => normalizeName(n).split(" "))
        .filter((t) => t.length >= 4 && !generic.has(t))
        .concat(names.filter((n) => /^[A-Z0-9]{2,8}$/.test(n)).map((n) => n.toLowerCase()))
        .concat(initials.flatMap((i) => (i.length >= 3 ? [i, i.replace(/^h/, "")] : []))),
    ),
  ];
}

/**
 * Why an address must not be published, or null when it may be. `clubNames` are the
 * club's name, aliases and acronym: an address made of the club's own words is the club's.
 */
export function emailPublishProblem(address: string, clubNames: readonly string[] = []): string | null {
  const m = address.trim().match(/^([^@\s]+)@([a-z0-9.-]+\.[a-z]{2,})$/i);
  if (!m) return "malformed";
  const [, local = "", domain = ""] = m;
  // "x@site.com.Get": text run into the address.
  if (/[A-Z]/.test(domain.split(".").pop() ?? "")) return "malformed";
  if (PLACEHOLDER_DOMAINS.test(domain)) return "placeholder";
  // A person written as FirstLast ("JenniferTiel").
  if (/^[A-Z][a-z]+[A-Z][a-z]+$/.test(local)) return "personal";
  const l = local.toLowerCase();
  const parts = l.split(/[._+-]/).filter(Boolean);
  const own = clubTokens(clubNames);
  const domainLabel = domain.toLowerCase().split(".").slice(-2, -1)[0] ?? "";
  const isOwn = (t: string) =>
    // Two letters are a role's initials ("sg@", "dg@"), not a person's handle.
    /^[a-z]{2}$/.test(t) ||
    ROLE_WORDS.some((w) => t === w || (w.length >= 5 && t.includes(w))) ||
    own.some((o) => t.includes(o) || (t.length >= 4 && o.includes(t))) ||
    t === domainLabel;
  // Every part of "first.last" names a person; one role or club word is enough otherwise.
  if (parts.some(isOwn)) return null;
  return "personal";
}
