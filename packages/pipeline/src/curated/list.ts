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

// 2026-10-03: Instagram handles removed from nine entries (GSS, HackHarvard, Piano Society, EMC,
// Hawaii, Hellenic, Plant Based, Science Olympiad, TCA): Instagram shows "Profile isn't available".
// 2026-10-05 (v8): owner-supplied short names SciOly, CLAX and TKD (the clubs' Instagram handles use them).
// 2026-10-07 (v9): Instagram for Harvard Cheerleading (+ its site) and seven clubs from saved search results.
// 2026-10-07 (v10): seven club-sport and club accounts whose titles name the club.
// 2026-10-12 (v11): The Harvard Advocate's site moved to harvardadvocate.org; the Wireless Club's site
// confirmed (read over http: its https certificate names another host).
export const CURATED_LIST_VERSION = "11";

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
    // Renamed: hodp.org redirects to hudp.org, titled "Harvard Undergraduate Data Project" (2026-10-02).
    slug: "harvard-undergraduate-open-data-project",
    name: "Harvard Undergraduate Data Project",
    acronym: "HUDP",
    aliases: ["Harvard Open Data Project", "Harvard Undergraduate Open Data Project"],
    rename: true,
    website: "https://www.hudp.org/",
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
    // Owner, 2026-10-03. The club site links no Instagram; search had matched @harvardpoker.
    instagram: "https://www.instagram.com/harvardundergradpoker",
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
  {
    slug: "apichorus-a-cappella",
    name: "ApiChorus A Cappella",

    categories: ["a-cappella"],
  },
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
  // 2026-10-05: a stand-up comedy group; Theater is the site's theater & comedy category.
  {
    slug: "harvard-undergraduate-stand-up-comics-society",
    name: "Harvard Undergraduate Stand-Up Comics Society",
    categories: ["theater"],
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
    // harvardpremed.com redirects here (2026-10-02).
    website: "https://www.hups.site/",
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
    website: "https://hausociety.com/",
    categories: ["academic-stem"],
  },
  {
    slug: "harvard-bangladeshi-students-association",
    name: "Harvard Bangladeshi Students Association",
    website: "https://harvardbsa.github.io/",
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
    website: "https://harvardnsa.org/",
    categories: ["cultural-identity"],
  },
  {
    slug: "harvard-college-symphony-society",
    name: "Harvard College Symphony Society",
    website: "https://www.symphonysociety.org/",
    categories: ["music"],
  },
  {
    slug: "harvard-salient",
    name: "The Harvard Salient",
    website: "https://www.harvardsalient.com/",
    categories: ["publications-media"],
  },
  {
    slug: "harvard-undergraduate-global-women-empowerment",
    name: "Harvard Undergraduate Global Women Empowerment",
    website: "https://www.huglobalwe.com/",
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
  // w1af.harvard.edu's https certificate names another host; the fetcher reads it over http.
  {
    slug: "harvard-college-wireless-club",
    name: "Harvard College Wireless Club",
    website: "https://w1af.harvard.edu/php/index.php",
  },
  // theharvardadvocate.com no longer resolves (2026-10-12); the Advocate is at harvardadvocate.org.
  { slug: "harvard-advocate", name: "The Harvard Advocate", website: "https://www.harvardadvocate.org/" },
  // The Harvard Independent's club comp rundown links this site as "Organization of Asian
  // American Sisters in Service (OAASIS)"; its home page states the full name in its mission.
  {
    slug: "organization-of-asian-american-sisters-in-service",
    name: "Organization of Asian American Sisters in Service",
    acronym: "OAASIS",
    website: "https://harvardoaasis.com/",
  },
  // Top-club pass (ADR 0044, 2026-10-02): official sites read by hand; each home page names the club.
  { slug: "harvard-crimson", name: "The Harvard Crimson", website: "https://www.thecrimson.com/" },
  { slug: "harvard-political-review", name: "Harvard Political Review", website: "https://harvardpolitics.com/" },
  { slug: "harvard-independent", name: "Harvard Independent", website: "https://harvardindependent.com/" },
  {
    slug: "harvard-radio-broadcasting-inc",
    name: "WHRB 95.3 FM - Harvard Radio Broadcasting",
    acronym: "WHRB",
    website: "https://www.whrb.org/",
  },
  { slug: "crimson-key-society", name: "Crimson Key Society", website: "https://crimsonkeysociety.org/" },
  { slug: "harvard-yearbook-publications", name: "Harvard Yearbook", website: "https://harvardyearbook.com/" },
  {
    slug: "harvard-institute-of-politics",
    name: "The Institute of Politics at Harvard University",
    website: "https://iop.harvard.edu/",
  },
  {
    slug: "phillips-brooks-house-association",
    name: "Phillips Brooks House Association",
    website: "https://www.pbha.org/",
  },
  {
    slug: "harvard-college-democrats",
    name: "Harvard College Democrats",
    website: "https://www.harvardcollegedems.org/",
  },
  {
    slug: "harvard-republican-club",
    name: "Harvard Republican Club",
    website: "https://www.harvardrepublicanclub.org/",
  },
  {
    slug: "harvard-model-united-nations",
    name: "Harvard Model United Nations",
    website: "https://www.harvardmun.org/",
  },
  {
    slug: "harvard-national-model-united-nations",
    name: "Harvard National Model United Nations",
    acronym: "HNMUN",
    website: "https://www.hnmun.org/",
  },
  { slug: "harvard-debate-council", name: "Harvard Debate Council", website: "https://www.harvarddebate.org/" },
  {
    slug: "harvard-college-debating-union",
    name: "Harvard College Debating Union",
    website: "https://www.harvardcollegedebatingunion.org/",
  },
  {
    slug: "harvard-undergraduate-mock-trial",
    name: "Harvard Undergraduate Mock Trial",
    website: "https://www.harvardundergraduatemocktrial.org/",
  },
  {
    slug: "harvard-undergraduate-effective-altruism",
    name: "Harvard Undergraduate Effective Altruism",
    website: "https://harvardundergradea.org/",
  },
  {
    slug: "harvard-undergraduate-faith-and-action",
    name: "Harvard Undergraduate Faith and Action",
    website: "https://www.harvardundergraduatefaithandaction.org/",
  },
  {
    slug: "harvard-investment-association",
    name: "Harvard Investment Association",
    website: "https://www.harvardinvestmentsassociation.org/",
  },
  {
    slug: "harvard-undergraduate-women-in-business",
    name: "Harvard Undergraduate Women in Business",
    acronym: "HUWIB",
    website: "https://huwib.com/home",
  },
  {
    slug: "harvard-undergraduate-economics-association",
    name: "Harvard Undergraduate Economics Association",
    website: "https://www.thehuea.org/",
  },
  {
    slug: "harvard-undergraduate-marketing-group",
    name: "Harvard Undergraduate Marketing Group",
    website: "https://harvardundergraduatemarketing.com/",
  },
  {
    slug: "harvard-undergraduate-biotechnology-club",
    name: "Harvard Undergraduate Biotechnology Club",
    website: "https://www.hubiotechclub.org/",
  },
  {
    slug: "harvard-undergraduate-women-in-computer-science",
    name: "Harvard Undergraduate Women in Computer Science",
    website: "https://wicsatharvard.com/",
  },
  {
    slug: "harvard-chess-club",
    name: "Harvard Chess Club",
    website: "https://harvardcrimsonches.wixsite.com/harvardchess/",
  },
  { slug: "harvard-krokodiloes", name: "The Harvard Krokodiloes", website: "https://www.kroks.com/" },
  { slug: "harvard-din-and-tonics", name: "The Harvard Din & Tonics", website: "https://www.dins.com/" },
  { slug: "radcliffe-pitches", name: "The Radcliffe Pitches", website: "https://www.pitches.org/" },
  { slug: "harvard-opportunes", name: "The Harvard Opportunes", website: "https://www.harvardopportunes.com/" },
  { slug: "harvard-lowkeys", name: "The Harvard LowKeys", website: "https://theharvardlowkeys.com/" },
  { slug: "harvard-callbacks", name: "The Harvard Callbacks", website: "https://www.harvardcallbacks.com/" },
  { slug: "harvard-glee-club", name: "Harvard Glee Club", website: "https://harvardgleeclub.org" },
  {
    slug: "harvard-radcliffe-dramatic-club",
    name: "Harvard-Radcliffe Dramatic Club",
    website: "https://hrdctheater.org/",
  },
  {
    slug: "immediate-gratification-players",
    name: "Immediate Gratification Players",
    website: "https://www.immediategratification.org/",
  },
  { slug: "harvard-pops-orchestra", name: "The Harvard Pops Orchestra", website: "https://www.harvardpops.com/" },
  {
    slug: "harvard-radcliffe-orchestra",
    name: "The Harvard-Radcliffe Orchestra",
    website: "https://harvardradcliffeorchestra.org/",
  },
  { slug: "harvard-university-band", name: "Harvard University Band", website: "https://harvardband.org/" },
  { slug: "harvard-ballet-company", name: "Harvard Ballet Company", website: "https://www.harvardballetcompany.org/" },
  {
    slug: "harvard-asian-american-dance-troupe",
    name: "Harvard Asian American Dance Troupe",
    website: "https://www.harvardundergraduateaadt.org/",
  },
  {
    slug: "crimson-dance-team-club-sport",
    name: "Harvard Crimson Dance Team",
    website: "https://harvardcdt.wixsite.com/gocrimson/",
  },
  {
    slug: "harvard-black-students-association",
    name: "Harvard Black Students Association",
    website: "https://www.theharvardbsa.com/",
  },
  {
    slug: "harvard-radcliffe-asian-american-association",
    name: "Harvard-Radcliffe Asian American Association",
    website: "https://harvardradcliffeaaa.org/",
  },
  { slug: "harvard-outing-club-inc", name: "Harvard Outing Club", website: "https://www.harvardoutingclub.org/" },
  {
    slug: "harvard-korean-association",
    name: "Harvard Korean Association",
    website: "https://harvardkoreanassociation.org/",
  },
  // Second top-club pass (ADR 0044, 2026-10-02).
  { slug: "1636-leadership-forum", name: "The 1636 Leadership Forum", website: "https://1636forum.org/" },
  { slug: "act-on-a-dream-at-harvard-college", name: "Act on a Dream", website: "https://actonadream.org/" },
  { slug: "exister-society", name: "The Exister Society", website: "https://www.existersociety.org/" },
  {
    slug: "harvard-african-students-association",
    name: "Harvard African Students Association",
    acronym: "HASA",
    website: "https://www.harvardafricans.com/",
  },
  { slug: "harvard-black-mens-forum", name: "Harvard Black Men's Forum", website: "https://www.harvardbmf.org/" },
  {
    slug: "harvard-climate-coalition",
    name: "Harvard Climate Coalition",
    website: "https://www.harvard-climate-coalition.org/",
  },
  {
    slug: "harvard-college-china-forum",
    name: "Harvard College China Forum",
    website: "https://harvardcollegechinaforum.org/",
  },
  {
    slug: "harvard-college-christian-students",
    name: "Harvard College Christian Students",
    website: "https://harvardcollegechristians.com/",
  },
  {
    slug: "harvard-college-generational-african-american-students-association",
    name: "Harvard College Generational African American Students Association",
    acronym: "GAASA",
    website: "https://www.harvardgaasa.com/",
  },
  {
    slug: "harvard-international-relations-council",
    name: "Harvard International Relations Council",
    acronym: "IRC",
    website: "https://www.harvardirc.org/",
  },
  {
    slug: "harvard-international-review",
    name: "Harvard International Review",
    acronym: "HIR",
    website: "https://harvardinternationalreview.com/",
  },
  { slug: "harvard-islamic-society", name: "Harvard Islamic Society", website: "https://harvardislamicsociety.com/" },
  {
    slug: "harvard-model-congress-middle-east",
    name: "Harvard Model Congress Middle East",
    acronym: "HMCME",
    website: "https://hmcmiddleeast.org/",
  },
  {
    slug: "harvard-program-for-international-education",
    name: "Harvard Program for International Education",
    acronym: "HPIE",
    website: "https://hpie.org/",
  },
  {
    slug: "harvard-seas-society-of-women-engineers",
    name: "Harvard Society of Women Engineers",
    acronym: "SWE",
    website: "https://www.harvardswe.com/",
  },
  {
    slug: "harvard-society-of-black-scientists-and-engineers",
    name: "The Harvard Society of Black Scientists and Engineers",
    acronym: "HSBSE",
    website: "https://hsbsecommunity.com/",
  },
  {
    slug: "harvard-undergraduate-beekeepers",
    name: "Harvard Undergraduate Beekeepers",
    acronym: "HUB",
    website: "https://harvardbeekeepers.wixsite.com/the-hubsite/",
  },
  {
    slug: "harvard-undergraduate-cancer-association",
    name: "Harvard Undergraduate Cancer Association",
    acronym: "HUCA",
    website: "https://www.joinhuca.org/",
  },
  {
    slug: "harvard-undergraduate-design-collective",
    name: "Harvard Undergraduate Design Collective",
    acronym: "HUDC",
    website: "https://hudc.carrd.co/",
  },
  {
    slug: "harvard-undergraduate-disability-justice-club",
    name: "Harvard Undergraduate Disability Justice Club",
    acronym: "HUDJ",
    website: "https://hudjclub.weebly.com/",
  },
  {
    slug: "harvard-undergraduate-edtech-group",
    name: "Harvard Undergraduate EdTech Group",
    acronym: "HUEG",
    website: "https://www.harvardedtech.org/",
  },
  {
    slug: "harvard-undergraduate-ethics-society",
    name: "Harvard Undergraduate Ethics Society",
    acronym: "HUES",
    website: "https://harvardundergraduateethics.org/",
  },
  {
    slug: "harvard-undergraduate-foreign-policy-initiative",
    name: "Harvard Undergraduate Foreign Policy Initiative",
    acronym: "HUFPI",
    website: "https://sites.harvard.edu/foreign-policy/",
  },
  {
    slug: "harvard-undergraduate-japan-society",
    name: "Harvard Undergraduate Japan Society",
    acronym: "HUJS",
    website: "https://www.harvardjapansociety.com/",
  },
  {
    slug: "harvard-undergraduate-kaizen-club",
    name: "Harvard College Kaizen Club",
    website: "https://harvardcollegekaizenclubcom.wordpress.com/",
  },
  {
    slug: "harvard-undergraduate-latinxs-in-finance-and-technology",
    name: "Harvard LiFT",
    acronym: "LiFT",
    website: "https://www.harvardundergraduatelift.org/",
  },
  {
    slug: "harvard-undergraduate-philippine-forum",
    name: "Harvard Undergraduate Philippine Forum",
    acronym: "HPF",
    website: "https://philippineforum.weebly.com/",
  },
  {
    slug: "harvard-undergraduate-psychedelics-club",
    name: "Harvard Undergraduate Psychedelics Club",
    website: "https://yanaylw.wixsite.com/harvardpsychedelics/",
  },
  {
    slug: "harvard-undergraduate-quantum-computing-association",
    name: "Harvard Undergraduate Quantum Computing Association",
    acronym: "HUQCA",
    website: "https://harvardquantum.com/",
  },
  {
    slug: "harvard-undergraduate-synapse-chapter",
    name: "Harvard Undergraduate Synapse Chapter",
    website: "https://harvardsynapse.wordpress.com/",
  },
  {
    slug: "harvard-undergraduate-rural-league",
    name: "Harvard Undergraduate Rural League",
    acronym: "HURL",
    website: "https://www.harvardundergradrural.org/",
  },
  {
    slug: "harvard-undergraduate-vision-global-health-society",
    name: "Harvard College Vision Global Health Society",
    website: "https://harvardcollegevisionghs.github.io/",
  },
  {
    slug: "harvard-undergraduate-women-in-medicine",
    name: "Harvard Undergraduate Women in Medicine",
    website: "https://www.harvardwomeninmedicine.org/",
  },
  {
    slug: "harvard-undergraduate-world-pre-health-conference",
    name: "Harvard Undergraduate World Pre-Health Conference",
    website: "https://www.huworldprehealthconference.org/",
  },
  {
    slug: "harvard-undergraduates-for-bipartisan-solutions",
    name: "Harvard Undergraduates for Bipartisan Solutions",
    acronym: "HUBS",
    website: "https://harvardundergraduatesforbipartisansolutions.org/",
  },
  { slug: "karate-club-sport", name: "The Harvard Karate Club", website: "https://www.harvardkarate.com/" },
  { slug: "la-vie-club", name: "La Vie Club", website: "https://www.lavieclub.org/" },
  {
    slug: "student-astronomers-at-harvard-radcliffe",
    name: "Student Astronomers at Harvard-Radcliffe",
    acronym: "STAHR",
    website: "https://sites.harvard.edu/stahr",
  },
  { slug: "women-in-ai", name: "Women in AI", website: "https://mitharvardwai.github.io/" },
  {
    slug: "small-claims-advisory-service",
    name: "Small Claims Advisory Service",
    acronym: "SCAS",
    website: "https://masmallclaims.org",
  },
  // Clubs with two search-matched Instagrams: the account the club's own site points to
  // (checked 2026-10-03). The other account stays recorded but no longer shows.
  {
    // auditions.html: "follow our Instagram @harvardfallenangels"; the footer icon is an older account.
    slug: "harvard-fallen-angels",
    name: "Fallen Angels",
    instagram: "https://www.instagram.com/harvardfallenangels",
  },
  {
    // hupb.org links @harvardplantbased; @hu.plant.based is only on an expired fall-2025 page.
    slug: "harvard-undergraduate-plant-based",
    name: "Harvard Undergraduate Plant Based",
  },
  {
    slug: "harvard-undergraduate-science-olympiad",
    name: "Harvard Undergraduate Science Olympiad",
  },
  {
    slug: "harvard-undergraduate-hellenic-society",
    name: "Harvard Undergraduate Hellenic Society",
  },
  // The rest had no club site naming an account; picked 2026-10-03 from other evidence.
  {
    // college.harvard.edu "Clubs on campus" student story: "Harvard Undergraduate Hawai'i Club Instagram".
    slug: "harvard-undergraduate-hawaii-club",
    name: "Harvard Undergraduate Hawai'i Club",
  },
  {
    // Same College page: "Harvard Undergraduate Tibetan Cultural Association Instagram".
    slug: "harvard-undergraduate-tibetan-cultural-association",
    name: "Harvard Undergraduate Tibetan Cultural Association",
  },
  {
    // The site's own Instagram link; its heading is "Harvard College Piano Society".
    slug: "harvard-college-students-piano-society",
    name: "Harvard College Students Piano Society",
    aliases: ["Harvard College Piano Society", "Harvard Piano Society"],
    website: "https://harvardcollegepianosociety.com/",
  },
  {
    // Bio repeats the College club's mission; @harvardarmenians speaks for undergrad and grad students.
    slug: "armenian-student-association-at-harvard-college",
    name: "Armenian Student Association at Harvard College",
    instagram: "https://www.instagram.com/asaharvardcollege",
  },
  {
    // Same handle as the club's domain and Facebook page (facebook.com/hmceurope).
    slug: "harvard-model-congress-europe",
    name: "Harvard Model Congress Europe",
    instagram: "https://www.instagram.com/hmceurope",
  },
  // Search showed one account active under the club's name (followers, recent posts); the
  // other never surfaced beyond its title.
  {
    slug: "hackharvard-undergraduate-hackathon",
    name: "HackHarvard Undergraduate Hackathon",
  },
  {
    slug: "harvard-undergraduate-palestine-solidarity-committee",
    name: "Harvard Undergraduate Palestine Solidarity Committee",
    instagram: "https://www.instagram.com/harvardundergradpsc",
  },
  { slug: "fig-magazine", name: "FIG. Magazine", instagram: "https://www.instagram.com/figzine" },
  {
    slug: "greener-scott-scholars-mentorship-program",
    name: "Greener Scott Scholars Mentorship Program",
  },
  {
    slug: "harvard-college-student-chapter-of-storywish",
    name: "Harvard College Student Chapter of Storywish",
    instagram: "https://www.instagram.com/hcsc_storywish",
  },
  {
    slug: "harvard-undergraduate-creative-writing-collective",
    name: "Harvard Undergraduate Creative Writing Collective",
    instagram: "https://www.instagram.com/harvardundergraduate_cwc",
  },
  {
    slug: "harvard-undergraduate-electronic-music-collective",
    name: "Harvard Undergraduate Electronic Music Collective",
  },
  // Named "College Events Board (CEB)" by the Harvard Gazette; plans campus-wide social events.
  { slug: "college-events-board", name: "College Events Board", acronym: "CEB", categories: ["social"] },
  // Empty-profile pass, 2026-10-03: club sites found by search; each page names the club.
  {
    slug: "harvard-classical-club",
    name: "Harvard Classical Club",
    website: "https://sites.harvard.edu/classicalclub/",
  },
  {
    slug: "harvard-radcliffe-modern-dance-company",
    name: "The Harvard-Radcliffe Modern Dance Company",
    acronym: "HRMDC",
    website: "https://www.hrmdc.org/",
    categories: ["dance"],
  },
  {
    slug: "harvard-undergraduate-christian-fellowship",
    name: "Harvard Undergraduate Christian Fellowship",
    website: "https://ruf.org/ministry/hucf/",
  },
  {
    slug: "harvard-undergraduate-music-in-hospitals-and-nursing-homes-using-entertainment",
    name: "Harvard Undergraduate Music In Hospitals and Nursing Homes Using Entertainment as Therapy",
    acronym: "MIHNUET",
    website: "https://sites.google.com/view/harvard-undergraduate-mihnuet/",
  },
  {
    slug: "harvard-world-model-united-nations",
    name: "Harvard World Model United Nations",
    // The site calls itself "Harvard WorldMUN" (its title and headings).
    aliases: ["Harvard WorldMUN"],
    website: "https://www.worldmun.org/",
  },
  { slug: "quad-bikes", name: "Quad Bikes", website: "https://sites.google.com/view/quadbikes/" },
  // Duplicate review, 2026-10-03: GuideStar lists the Harvard Catholic Center as "Formerly known as:
  // Harvard-Radcliffe Catholic Student Association / Catholic Student Association".
  { slug: "catholic-student-association", name: "Catholic Student Association", aliases: ["Harvard Catholic Center"] },
  // Instagram accounts confirmed by the owner, 2026-10-03.
  // ICMUN: its own site (harvardicmun.com) links @harvardicmun; harvardirc.org and Wikipedia write
  // "Harvard Intercollegiate Model United Nations (ICMUN)".
  {
    slug: "harvard-intercollegiate-model-united-nations",
    name: "Harvard Intercollegiate Model United Nations",
    acronym: "ICMUN",
    website: "https://harvardicmun.com/",
    instagram: "https://www.instagram.com/harvardicmun/",
  },
  // A College student story writes "The Bengali Association of Students at Harvard(BASHA)".
  {
    slug: "bengali-association-of-students-at-harvard-college",
    name: "Bengali Association of Students at Harvard College",
    acronym: "BASHA",
    instagram: "https://www.instagram.com/harvardbasha/",
  },
  // SOCO registers "…for U.S. Cross-cultural Relations"; the account and other pages call the same
  // College group the Association for U.S.-China Relations (HAUSCR).
  {
    slug: "harvard-undergraduate-association-for-u-s-cross-cultural-relations",
    name: "Harvard Undergraduate Association for U.S. Cross-cultural Relations",
    acronym: "HAUSCR",
    aliases: ["Harvard Undergraduate Association for U.S.-China Relations"],
    instagram: "https://www.instagram.com/huauscr/",
  },
  // 2026-10-03: current accounts for clubs whose linked handle no longer exists; found by search,
  // each profile read directly and its display name is the club's name (or its acronym with the name in the bio).
  {
    slug: "greener-scott-scholars-mentorship-program",
    name: "Greener Scott Scholars Mentorship Program",
    instagram: "https://www.instagram.com/greenerscottscholars/",
  },
  {
    slug: "hackharvard-undergraduate-hackathon",
    name: "HackHarvard Undergraduate Hackathon",
    instagram: "https://www.instagram.com/hhuh.hackathon/",
  },
  {
    slug: "harvard-christian-impact",
    name: "Harvard Christian Impact",
    instagram: "https://www.instagram.com/harvardchristianimpact/",
  },
  {
    slug: "harvard-college-debating-union",
    name: "Harvard College Debating Union",
    instagram: "https://www.instagram.com/harvardcollegedebatingunion/",
  },
  {
    slug: "harvard-college-students-piano-society",
    name: "Harvard College Students Piano Society",
    instagram: "https://www.instagram.com/hcspianosociety/",
  },
  {
    slug: "harvard-undergraduate-capital-partners",
    name: "Harvard Undergraduate Capital Partners",
    instagram: "https://www.instagram.com/harvardundergradcapital/",
  },
  {
    slug: "harvard-undergraduate-electronic-music-collective",
    name: "Harvard Undergraduate Electronic Music Collective",
    instagram: "https://www.instagram.com/harvardundergrademc/",
  },
  {
    slug: "harvard-undergraduate-foreign-policy-initiative",
    name: "Harvard Undergraduate Foreign Policy Initiative",
    instagram: "https://www.instagram.com/harvardundergradforeignpol/",
  },
  {
    slug: "harvard-undergraduate-hellenic-society",
    name: "Harvard Undergraduate Hellenic Society",
    instagram: "https://www.instagram.com/harvardundergraduatehellenic/",
  },
  {
    slug: "harvard-undergraduate-marketing-group",
    name: "Harvard Undergraduate Marketing Group",
    instagram: "https://www.instagram.com/harvardundergraduatemarketing/",
  },
  {
    slug: "harvard-undergraduate-philippine-forum",
    name: "Harvard Undergraduate Philippine Forum",
    instagram: "https://www.instagram.com/philippineforum/",
  },
  {
    slug: "harvard-undergraduate-real-estate-investment-group",
    name: "Harvard Undergraduate Real Estate Investment Group",
    instagram: "https://www.instagram.com/harvardreig/",
  },
  {
    slug: "harvard-undergraduate-science-olympiad",
    name: "Harvard Undergraduate Science Olympiad",
    acronym: "SciOly",
    instagram: "https://www.instagram.com/huscioly/",
  },
  {
    slug: "harvard-undergraduate-synapse-chapter",
    name: "Harvard Undergraduate Synapse Chapter",
    instagram: "https://www.instagram.com/harvard_undergrad_synapse/",
  },
  {
    slug: "harvard-undergraduate-tibetan-cultural-association",
    name: "Harvard Undergraduate Tibetan Cultural Association",
    instagram: "https://www.instagram.com/harvardundergraduatetca/",
  },
  {
    slug: "harvard-undergraduate-venture-capital-group",
    name: "Harvard Undergraduate Venture Capital Group",
    instagram: "https://www.instagram.com/harvarduvcg/",
  },
  {
    slug: "indigo-peer-counseling",
    name: "Indigo Peer Counseling",
    instagram: "https://www.instagram.com/indigopeercounseling/",
  },
  {
    slug: "partners-in-health-engage",
    name: "Harvard Undergraduate Partners in Health Engage",
    instagram: "https://www.instagram.com/pihengage.hu/",
  },
  // 2026-10-04: accounts for clubs that had none; found by a name search, each profile read directly
  // and its display name passes the importer's club-name check (displayNameMatchesClub).
  { slug: "cricket-club-sport", name: "Harvard Cricket Club", instagram: "https://www.instagram.com/harvardcricket/" },
  { slug: "harvard-lampoon", name: "Harvard Lampoon", instagram: "https://www.instagram.com/harvardlampoon/" },
  {
    slug: "harvard-college-asian-student-arts-project",
    name: "Asian Student Arts Project",
    instagram: "https://www.instagram.com/harvardasap/",
  },
  {
    slug: "harvard-undergraduate-christian-fellowship",
    name: "Harvard Undergraduate Christian Fellowship",
    instagram: "https://www.instagram.com/harvardruf/",
  },
  {
    slug: "volleyball-mens-club-sport",
    name: "Harvard Men's Volleyball Club",
    instagram: "https://www.instagram.com/harvardclubvball/",
  },
  {
    slug: "ice-hockey-womens-club-sport",
    name: "Harvard Women's Ice Hockey Club",
    instagram: "https://www.instagram.com/harvard_womens_club_hockey/",
  },
  {
    slug: "harvard-undergraduate-linguistics-society",
    name: "Harvard Undergraduate Linguistics Society",
    instagram: "https://www.instagram.com/harvardlinguistics/",
  },
  { slug: "harvard-salient", name: "The Harvard Salient", instagram: "https://www.instagram.com/theharvardsalient/" },
  {
    slug: "harvard-women-in-entrepreneurship",
    name: "Harvard Undergraduate Women In Entrepreneurship",
    instagram: "https://www.instagram.com/harvardundergradwe/",
  },
  { slug: "golf-club-sport", name: "Harvard Golf Club", instagram: "https://www.instagram.com/harvardgolfclub/" },
  {
    slug: "lacrosse-mens-club-sport",
    name: "Harvard Men's Lacrosse Club",
    acronym: "CLAX",
    instagram: "https://www.instagram.com/harvardclax/",
  },
  { slug: "taekwondo-club-sport", name: "Harvard Taekwondo Club", acronym: "TKD" },
  {
    slug: "hasty-pudding-theatricals",
    name: "Hasty Pudding Theatricals",
    instagram: "https://www.instagram.com/thehastypudding/",
  },
  {
    slug: "harvard-computer-society-tech-for-social-good",
    name: "Harvard Computer Society Tech for Social Good",
    instagram: "https://www.instagram.com/harvardt4sg/",
  },
  { slug: "harvard-deepam", name: "Harvard Undergraduate Deepam", instagram: "https://www.instagram.com/hudeepam/" },
  {
    slug: "harvard-college-pakistani-students-association",
    name: "Harvard College Pakistani Students Association",
    instagram: "https://www.instagram.com/harvardcollegepsa/",
  },
  {
    slug: "harvard-mozart-society-orchestra",
    name: "Harvard-Radcliffe Mozart Society Orchestra",
    instagram: "https://www.instagram.com/mozartsocietyorchestra/",
  },
  {
    slug: "woodbridge-society-of-international-students",
    name: "Woodbridge International Society",
    instagram: "https://www.instagram.com/woodbridge_international/",
  },
  {
    slug: "healthpath-horizons",
    name: "HealthPath Horizons",
    instagram: "https://www.instagram.com/healthpathhorizons/",
  },
  {
    slug: "hbs-entrepreneurship-club",
    name: "HBS Entrepreneurship Club",
    instagram: "https://www.instagram.com/hbsentrepreneurshipclub/",
  },
  {
    slug: "volleyball-womens-club-sport",
    name: "Harvard Women's Volleyball Club",
    instagram: "https://www.instagram.com/harvardwcvb/",
  },
  {
    // 2026-10-04: satirev.org links the club's verified handle (@therealsatirev). The one-word
    // name passes the site check only as an exact short name.
    slug: "satirev",
    name: "SatireV",
    acronym: "SatireV",
    website: "https://satirev.org/",
    instagram: "https://www.instagram.com/therealsatirev/",
  },
  {
    slug: "harvard-public-opinion-project",
    name: "Harvard Public Opinion Project",
    instagram: "https://www.instagram.com/harvardyouthpoll/",
  },
  { slug: "datamatch", name: "Datamatch", instagram: "https://www.instagram.com/datamatch/" },
  {
    slug: "skiing-club-sport",
    name: "Harvard Ski Club",
    instagram: "https://www.instagram.com/harvardcollegeskiclub/",
  },
  {
    slug: "lacrosse-womens-club-sport",
    name: "Harvard Women's Lacrosse Club",
    instagram: "https://www.instagram.com/harvardlacrosse/",
  },
  { slug: "kali-praxi", name: "Kal\u00ed Prax\u00ed", instagram: "https://www.instagram.com/thekalipraxi/" },
  // 2026-10-04, owner: both accounts named for these clubs are linked; each club ranks by the larger count.
  {
    slug: "harvard-wind-ensemble",
    name: "Harvard Wind Ensemble",
    instagram: "https://www.instagram.com/harvardwinds/",
  },
  {
    slug: "harvard-wind-ensemble",
    name: "Harvard Wind Ensemble",
    instagram: "https://www.instagram.com/harvardwindensemble/",
  },
  { slug: "crimson-faith", name: "Crimson Faith", instagram: "https://www.instagram.com/crimsonfaithco/" },
  { slug: "crimson-faith", name: "Crimson Faith", instagram: "https://www.instagram.com/crmsonfaith/" },
  // 2026-10-07 (v9), owner report: Harvard Cheerleading's site links @harvardcheerleading. The
  // others are accounts found in saved search results whose titles name the Harvard club,
  // read by hand (national chapters, other schools and clubs with several candidate accounts left out).
  {
    slug: "cheer-club-sport",
    name: "Harvard Cheerleading Club",
    aliases: ["Harvard Cheerleading"],
    website: "https://harvardcheerleading.wixsite.com/cheer",
    instagram: "https://www.instagram.com/harvardcheerleading/",
  },
  {
    slug: "harvard-ballroom-team",
    name: "The Harvard Ballroom Team",
    instagram: "https://www.instagram.com/harvardballroom/",
  },
  {
    slug: "harvard-college-latinos-in-health-careers",
    name: "Harvard Undergraduate Latines in Health Careers",
    instagram: "https://www.instagram.com/harvardlihc/",
  },
  {
    slug: "harvard-jazz-orchestra",
    name: "Harvard Jazz Orchestra",
    instagram: "https://www.instagram.com/harvardjazzorchestra/",
  },
  {
    slug: "harvard-university-jazz-bands",
    name: "The Harvard University Jazz Bands",
    instagram: "https://www.instagram.com/harvardjazzbands/",
  },
  {
    slug: "harvard-undergraduate-brazilian-association",
    name: "Harvard Undergraduate Brazilian Association",
    instagram: "https://www.instagram.com/harvardbrazil/",
  },
  {
    slug: "harvard-undergraduate-student-chapter-of-the-american-chemical-society",
    name: "Harvard Undergraduate Student Chapter of the American Chemical Society",
    instagram: "https://www.instagram.com/harvard_acs/",
  },
  { slug: "running-club-sport", name: "Harvard Running Club", instagram: "https://www.instagram.com/hcrcinsta/" },
  // 2026-10-07 (v10): club-sport accounts whose titles name the club, not the varsity team
  // ("Harvard Men's Club Hockey", "Harvard Club Swim"), from saved search results.
  {
    slug: "ice-hockey-mens-club-sport",
    name: "Harvard Men's Ice Hockey Club",
    instagram: "https://www.instagram.com/harvardclockey/",
  },
  {
    slug: "basketball-womens-club-sport",
    name: "Harvard Women's Basketball Club",
    instagram: "https://www.instagram.com/harvardwcbb/",
  },
  {
    slug: "ultimate-frisbee-womens-club-sport",
    name: "Harvard Women's Ultimate Frisbee Club",
    instagram: "https://www.instagram.com/quasarultimate/",
  },
  { slug: "swimming-club-sport", name: "Harvard Swimming Club", instagram: "https://www.instagram.com/punchclubswim/" },
  {
    slug: "rugby-mens-club-sport",
    name: "Harvard Men's Rugby Club",
    instagram: "https://www.instagram.com/harvardmrugby/",
  },
  { slug: "squash-club-sport", name: "Harvard Squash Club", instagram: "https://www.instagram.com/harvardclubsquash/" },
  {
    slug: "harvard-international-genetically-engineered-machine",
    name: "Harvard Undergraduate International Genetically Engineered Machines",
    instagram: "https://www.instagram.com/harvardigem/",
  },
];
