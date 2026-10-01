import { z } from "zod";

/**
 * Owner-curated club list (ADR 0024). Each entry names a club and the links the index
 * editor supplied for it. Names and URLs only: nothing about the editor's own
 * applications or opinions belongs here.
 *
 * `slug` attaches the entry to an existing club; without it the matcher decides, and a
 * club is created only when nothing similar exists. A website is accepted only after its
 * fetched page names the club; social links are recorded as supplied and never fetched.
 */
export const CuratedEntry = z.object({
  name: z.string().min(3),
  acronym: z.string().min(2).max(20).optional(),
  /** Other names the club's pages may use (matching only). */
  aliases: z.array(z.string().min(3)).optional(),
  /**
   * The editor confirmed `name` is the club's current name (e.g. after a rename): it is
   * claimed even for an existing club, whose website must then show it.
   */
  rename: z.literal(true).optional(),
  /** The editor checked that the club isn't indexed yet: skip the "similar to…" review gate. */
  isNew: z.literal(true).optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
  website: z.string().url().optional(),
  /** Category slugs the editor assigns (a subcategory implies its parent). */
  categories: z
    .array(z.string().regex(/^[a-z0-9-]+$/))
    .min(1)
    .max(3)
    .optional(),
  instagram: z
    .string()
    .url()
    .refine((u) => /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+\/?$/.test(u), "Instagram profile URL")
    .optional(),
});
export type CuratedEntry = z.infer<typeof CuratedEntry>;

export const CURATED_LIST_VERSION = "2";

export const CURATED_CLUBS: CuratedEntry[] = [
  // Already indexed: add or confirm links.
  {
    slug: "pickleball-club-sport",
    name: "Harvard Pickleball Club",
    instagram: "https://www.instagram.com/harvardpickleballclub/",
  },
  {
    slug: "badminton-club-sport",
    name: "Harvard Badminton Club",
    instagram: "https://www.instagram.com/harvardbadminton",
  },
  { slug: "ai-safety-student-team", name: "AI Safety Student Team", acronym: "AISST", website: "https://aisst.ai/" },
  {
    slug: "harvard-undergraduate-open-data-project",
    name: "Harvard Open Data Project",
    acronym: "HODP",
    website: "https://www.hodp.org/",
  },
  {
    slug: "group-for-undergraduates-in-statistics-at-harvard-college",
    name: "Group for Undergraduates in Statistics at Harvard",
    acronym: "GUSH",
    website: "https://gushclub.org/",
  },
  {
    slug: "harvard-financial-analysts-club",
    name: "Harvard Financial Analysts Club",
    acronym: "HFAC",
    website: "https://www.harvardfac.org/",
  },
  {
    slug: "harvard-undergraduate-quantitative-traders",
    name: "Harvard Undergraduate Quantitative Traders",
    acronym: "HUQT",
    website: "https://www.huqt.com/",
  },
  { slug: "harvard-college-ventures", name: "Harvard Ventures", website: "https://www.harvardventures.org/" },
  {
    slug: "harvard-undergraduate-mathematics-association",
    name: "Harvard Undergraduate Mathematics Association",
    acronym: "HUMA",
    website: "https://www.harvardundergraduatemathematics.com/",
  },
  {
    slug: "harvard-undergraduate-combat-robotics-club",
    name: "Harvard Undergraduate Combat Robotics Club",
    acronym: "HUCRC",
    instagram: "https://www.instagram.com/harvardundergradcrc",
  },
  {
    slug: "harvard-undergraduate-robotics-club",
    name: "Harvard Undergraduate Robotics Club",
    acronym: "HURC",
    instagram: "https://www.instagram.com/hurcofficial/",
  },
  {
    slug: "harvard-machine-intelligence-community",
    name: "Harvard Undergraduate Machine Intelligence Community",
    acronym: "HUMIC",
    website: "https://www.humic.ai/",
  },
  {
    slug: "harvard-undergraduate-venture-capital-group",
    name: "Harvard Undergraduate Venture Capital Group",
    acronym: "VCG",
    website: "https://www.harvarduvcg.org/",
  },
  {
    slug: "harvard-project-for-asian-and-international-relations",
    name: "Harvard Project for Asian and International Relations",
    acronym: "HPAIR",
    website: "https://www.hpair.org/",
  },
  {
    slug: "harvard-computer-society-tech-for-social-good",
    name: "Harvard Tech for Social Good",
    acronym: "T4SG",
    aliases: ["Tech for Social Good"],
    website: "https://socialgood.hcs.harvard.edu/",
  },
  { slug: "harvard-lampoon", name: "The Harvard Lampoon", website: "https://harvardlampoon.com/" },
  {
    slug: "harvard-undergraduate-data-analytics-group",
    name: "Harvard Undergraduate Data Analytics Group",
    acronym: "HDAG",
    website: "https://harvardanalytics.org/",
  },
  {
    slug: "harvard-college-consulting-group",
    name: "Harvard Undergraduate Consulting Group",
    acronym: "HUCG",
    aliases: ["Harvard College Consulting Group"],
    rename: true,
    website: "https://www.harvardconsulting.org/",
  },
  {
    slug: "harvard-undergraduate-consulting-on-business-and-the-environment",
    name: "Harvard Undergraduate Consulting on Business and the Environment",
    acronym: "HUCBE",
    aliases: ["Consulting on Business and the Environment"],
    website: "https://www.hucbe.org/",
  },
  {
    slug: "harvard-undergraduate-capital-partners",
    name: "Harvard Undergraduate Capital Partners",
    acronym: "HUCP",
    website: "https://www.harvardcap.org/",
  },

  // Not yet indexed.
  {
    isNew: true,
    name: "Harvard Undergraduate Poker Club",
    aliases: ["Harvard College Poker Club", "Harvard Poker Club"],
    website: "https://harvardcollegepoker.com/",
  },
  {
    name: "Harvard Undergraduate Effective Altruism",
    aliases: ["Harvard Effective Altruism", "Effective Altruism at Harvard"],
    website: "https://harvardundergradea.org/",
  },
  { name: "Charles River Economics Labs", acronym: "CREL", website: "https://www.charlesrivereconomicslabs.org/" },
  { name: "Harvard Undergraduates in Asia Program", acronym: "HUAP", website: "https://www.huapconference.org/" },
  {
    name: "Harvard College Steelpan Ensemble",
    aliases: ["Harvard Steelpan Ensemble"],
    website: "https://harvardcollegesteelpan.com/",
  },
  // Audit review (ADR 0033): categories the clubs' own descriptions support but the index lacked.
  { slug: "apichorus-a-cappella", name: "ApiChorus A Cappella", categories: ["a-cappella"] },
  {
    slug: "harvard-undergraduate-law-review",
    name: "Harvard Undergraduate Law Review",
    categories: ["publications-media"],
  },
  {
    name: "Lowell House Society of Russian Bell Ringers",
    categories: ["music"],
    instagram: "https://www.instagram.com/lowellbellringers/",
  },
  {
    isNew: true,
    name: "Harvard Undergraduate Birding Club",
    categories: ["hobbies-games"],
    instagram: "https://www.instagram.com/harvardundergraduatebirding/",
  },
  {
    name: "Harvard Undergraduate Alternative Investment Club",
    acronym: "HAI",
    aliases: ["Harvard Alternative Investments"],
    website: "https://hualtinvest.com/",
  },
  { name: "Startups at Harvard", website: "https://www.startupsatharvard.com/" },
  {
    isNew: true,
    name: "Harvard Undergraduate Society for AI",
    acronym: "HUSAI",
    aliases: ["Harvard Undergraduate Society for Artificial Intelligence"],
    website: "https://ai.hcs.harvard.edu/",
  },
  {
    isNew: true,
    name: "Harvard Christian Impact",
    aliases: ["Cru at Harvard", "Harvard Cru"],
    website: "http://harvardci.com/",
  },
  {
    name: "Black Diamond Capital Investors",
    aliases: ["Black Diamond Capital"],
    website: "https://www.blackdiamondcapital.info/",
  },
  {
    name: "Harvard Undergraduate Marketing Group",
    acronym: "HUMG",
    website: "https://harvardundergraduatemarketing.com/",
  },
  {
    name: "Harvard Undergraduate Real Estate Investment Group",
    acronym: "HUREIG",
    aliases: ["Harvard Real Estate Investment Group"],
    website: "https://www.harvardreig.com/",
  },
  {
    isNew: true,
    name: "The Crimson: Business Board",
    aliases: ["Crimson Business", "The Harvard Crimson Business Board"],
    website: "https://business.thecrimson.com/",
  },
  {
    name: "Harvard Asian American Dance Troupe",
    acronym: "AADT",
    website: "https://www.harvardundergraduateaadt.org/",
  },
  { name: "Harvard-MIT Mathematics Tournament", acronym: "HMMT", website: "https://www.hmmt.org/" },
  // Web-discovery review items (the matcher's "similar" club was a different org, or had no site).
  {
    slug: "harvard-premedical-society",
    name: "Harvard Undergraduate Premedical Society",
    aliases: ["Harvard Premedical Society"],
    website: "https://harvardpremed.com/",
  },
  {
    slug: "harvard-undergraduate-veterans-organization",
    name: "Harvard Undergraduate Veterans",
    aliases: ["Harvard Undergraduate Veterans Organization"],
    website: "https://huvets.com/",
  },
  { isNew: true, name: "Harvard Undergraduate Economics Association", website: "https://thehuea.org/" },
  { isNew: true, name: "Harvard Debate Council", website: "https://harvarddebate.org/" },
  // Found by web discovery under its site's tagline; named as its home page states.
  {
    isNew: true,
    name: "Harvard College Union Society",
    aliases: ["The Union Society"],
    website: "https://theharvardunion.org/",
  },
  {
    name: "Harvard-Radcliffe Chinese Students Association",
    acronym: "CSA",
    aliases: ["Harvard Chinese Students Association"],
    website: "https://harvardradcliffecsa.org/",
  },

  // Categories for clubs no source categorized (editor-assigned, 2026-09-30).
  { slug: "haitians-at-harvard", name: "Haitians at Harvard", categories: ["cultural-identity"] },
  {
    slug: "harvard-architecture-undergraduate-society",
    name: "Harvard Architecture Undergraduate Society",
    categories: ["academic-stem"],
  },
  {
    slug: "harvard-bangladeshi-students-association",
    name: "Harvard Bangladeshi Students Association",
    categories: ["cultural-identity"],
  },
  {
    slug: "harvard-chinese-students-and-scholars-association",
    name: "Harvard Chinese Students & Scholars Association",
    categories: ["cultural-identity"],
  },
  {
    slug: "harvard-college-nigerian-students-association",
    name: "Harvard College Nigerian Students Association",
    categories: ["cultural-identity"],
  },
  { slug: "harvard-college-symphony-society", name: "Harvard College Symphony Society", categories: ["music"] },
  { slug: "harvard-salient", name: "The Harvard Salient", categories: ["publications-media"] },
  {
    slug: "harvard-undergraduate-global-women-empowerment",
    name: "Harvard Undergraduate Global Women Empowerment",
    categories: ["advocacy-justice"],
  },
  {
    slug: "harvard-undergraduate-microbiology-society",
    name: "Harvard Undergraduate Microbiology Society",
    categories: ["academic-stem"],
  },
  {
    slug: "harvard-undergraduate-society-for-ai",
    name: "Harvard Undergraduate Society for AI",
    categories: ["academic-stem"],
  },
  {
    slug: "harvard-undergraduate-urban-sustainability-lab",
    name: "Harvard Undergraduate Urban Sustainability Lab",
    categories: ["academic-stem"],
  },
  { slug: "israel-summit-at-harvard", name: "Israel Summit at Harvard", categories: ["political-advocacy"] },
  // The bare domain stopped resolving (SERVFAIL, 2026-10-01); the www host serves the site.
  { slug: "harvard-advocate", name: "The Harvard Advocate", website: "https://www.theharvardadvocate.com/" },
];
