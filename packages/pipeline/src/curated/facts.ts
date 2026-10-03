import { z } from "zod";
import {
  ClassYearsValue,
  DuesValue,
  HoursPerWeek,
  JoinModeValue,
  MembershipEstimate,
  RecruitingSeasonsValue,
} from "@hci/core";

/**
 * Editor-read facts (ADR 0044). The index editor reads a club's own page and lists what it
 * says, each value with the sentence that says it. The `facts` stage fetches the page
 * (polite fetcher, robots honored), requires every quote to appear verbatim in its text and
 * every number in a value to appear in its quote, and only then writes `stated` claims
 * evidenced by that snapshot, at the page's own tier. Nothing here is taken on the editor's
 * word: a page that stops saying it fails the next run, and the claim can be retracted.
 *
 * Only club-level fields students ask about first. Dated recruiting rounds stay with the
 * recruiting pass, which owns cycle identity and term rules.
 */
const Quote = z.string().trim().min(12).max(400);

export const CuratedFact = z.discriminatedUnion("field", [
  z.object({ field: z.literal("club.join_mode"), value: JoinModeValue, quote: Quote }),
  z.object({ field: z.literal("club.freshmen_eligible"), value: z.boolean(), quote: Quote }),
  z.object({ field: z.literal("club.eligible_classes"), value: ClassYearsValue, quote: Quote }),
  z.object({ field: z.literal("club.hours_per_week"), value: HoursPerWeek, quote: Quote }),
  z.object({ field: z.literal("club.member_count"), value: MembershipEstimate, quote: Quote }),
  z.object({ field: z.literal("club.dues"), value: DuesValue, quote: Quote }),
  z.object({ field: z.literal("club.recruiting_seasons"), value: RecruitingSeasonsValue, quote: Quote }),
  z.object({ field: z.literal("club.experience_required"), value: z.string().trim().min(3).max(200), quote: Quote }),
  z.object({ field: z.literal("club.meeting_frequency"), value: z.string().trim().min(3).max(200), quote: Quote }),
  // Text fields: the value is copied from the page, so it must sit inside its quote verbatim.
  z.object({ field: z.literal("club.mission"), value: z.string().trim().min(12).max(400), quote: Quote }),
  z.object({ field: z.literal("club.long_description"), value: z.string().trim().min(40).max(400), quote: Quote }),
  z.object({ field: z.literal("club.activity"), value: z.string().trim().min(3).max(120), quote: Quote }),
]);
export type CuratedFact = z.infer<typeof CuratedFact>;

export const CuratedFactsEntry = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** The page that states the facts. One page per entry; list a club twice for two pages. */
  url: z.string().url(),
  facts: z.array(CuratedFact).min(1).max(12),
});
export type CuratedFactsEntry = z.infer<typeof CuratedFactsEntry>;

export const CURATED_FACTS_VERSION = "1";

// Top-club pass, 2026-10-02: pages read by hand, quotes copied from `hci page-text` output.
export const CURATED_FACTS: CuratedFactsEntry[] = [
  {
    slug: "harvard-crimson",
    url: "https://www.thecrimson.com/about/",
    facts: [
      {
        field: "club.join_mode",
        value: "comp",
        quote:
          "If you are a Harvard College student, you are eligible to join, or “comp,” any of The Crimson’s 10 boards: News, Business, Editorial, Arts, Blog, Design, Magazine, Multimedia, Sports, and Technology.",
      },
      {
        field: "club.recruiting_seasons",
        value: ["fall", "spring"],
        quote: "Students may comp in both the fall and spring.",
      },
    ],
  },
  {
    slug: "harvard-crimson",
    url: "https://comp.thecrimson.com/",
    facts: [
      {
        field: "club.experience_required",
        value: "No experience needed",
        quote: "No experience neededMost Crimson editors had never worked for a newspaper before their comp",
      },
    ],
  },
  {
    slug: "crimson-technology-board",
    url: "https://visitas.thecrimson.com/tech/",
    facts: [
      {
        field: "club.join_mode",
        value: "comp",
        quote:
          "The Tech Comp is designed to accommodate programmers with all levels of experience. Many have joined the board before even finishing CS50!",
      },
      {
        field: "club.experience_required",
        value: "All levels of experience welcome",
        quote:
          "The Tech Comp is designed to accommodate programmers with all levels of experience. Many have joined the board before even finishing CS50!",
      },
    ],
  },
  {
    slug: "harvard-advocate",
    url: "https://www.theharvardadvocate.com/comp",
    facts: [
      {
        field: "club.join_mode",
        value: "comp",
        quote:
          "The Advocate holds comps for all seven boards: Art, Features, Fiction, Poetry, Design, Business, and Tech.",
      },
      {
        field: "club.experience_required",
        value: "No previous experience necessary",
        quote:
          "No previous experience is necessary. You don't have to be a writer or an artist—as long as you're interested in what we do, Advo has a place for you.",
      },
    ],
  },
  {
    slug: "harvard-political-review",
    url: "https://harvardpolitics.com/comp/",
    facts: [
      {
        field: "club.experience_required",
        value: "No experience required",
        quote:
          "We welcome all Harvard College students, regardless of concentration, level of experience, or political leaning.",
      },
    ],
  },
  {
    slug: "harvard-independent",
    url: "https://harvardindependent.com/comp/",
    facts: [
      {
        field: "club.experience_required",
        value: "No experience necessary",
        quote: "make Insta reels, sell ads, or whatever you bring to the table. No experience necessary!",
      },
    ],
  },
  {
    slug: "satirev",
    url: "https://satirev.org/comp",
    facts: [
      {
        field: "club.join_mode",
        value: "comp",
        quote: "Satire V holds semesterly editorial, graphics, business, and tech comps.",
      },
      {
        field: "club.recruiting_seasons",
        value: ["fall", "spring"],
        quote: "Satire V holds semesterly editorial, graphics, business, and tech comps.",
      },
      {
        field: "club.experience_required",
        value: "No comedy experience needed",
        quote:
          "Not a problem! The vast majority of our staff writers comped with no previous comedy writing experience.",
      },
    ],
  },
  {
    slug: "crimson-key-society",
    url: "https://crimsonkeysociety.org/comp-key/",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["spring"],
        quote:
          "Our comp process takes place in the spring semester, keep an eye out for comp posters and red sweaters this spring!",
      },
      {
        field: "club.experience_required",
        value: "No requirements for comping",
        quote:
          "Absolutely no requirements for comping except a willingness to engage with Harvard’s history and help strengthen the Crimson Key and Harvard communities.",
      },
    ],
  },
  {
    slug: "harvard-yearbook-publications",
    url: "https://harvardyearbook.com/join-us",
    facts: [
      {
        field: "club.join_mode",
        value: "comp",
        quote: "If you've ever been curious about what it takes to run your own business, comp this board!",
      },
      {
        field: "club.experience_required",
        value: "No prior experience necessary",
        quote: "No prior experience is necessary; we will teach you the valuable professional skills you need to know",
      },
    ],
  },
  {
    slug: "harvard-institute-of-politics",
    url: "https://iop.harvard.edu/programs",
    facts: [
      {
        field: "club.join_mode",
        value: "application",
        quote:
          "Harvard undergraduates can get involved with the IOP by applying to any student programs that interest you at the beginning of each semester through the IOP Common Application.",
      },
      {
        field: "club.recruiting_seasons",
        value: ["fall", "spring"],
        quote:
          "Harvard undergraduates can get involved with the IOP by applying to any student programs that interest you at the beginning of each semester through the IOP Common Application.",
      },
    ],
  },
  {
    slug: "phillips-brooks-house-association",
    url: "https://www.pbha.org/apply",
    facts: [
      {
        field: "club.join_mode",
        value: "application",
        quote:
          "The Common Application is used by all of our 50 programs. After your application has been received, look for an update or offer email, request for an interview, or more details from specific program directors.",
      },
    ],
  },
  {
    slug: "phillips-brooks-house-association",
    url: "https://www.pbha.org/",
    facts: [
      {
        field: "club.member_count",
        value: {
          kind: "exact",
          count: 1200,
        },
        quote:
          "Each year, 1,200 student volunteers join the Phillips Brooks House Association to run more than 50 social service and social action programs, serving more than 7,000 constituents.",
      },
    ],
  },
  {
    slug: "harvard-national-model-united-nations",
    url: "https://www.hnmun.org/",
    facts: [
      {
        field: "club.member_count",
        value: {
          kind: "range",
          min: 150,
          max: null,
        },
        quote:
          "Our staff of over 150 undergraduate students from Harvard College is committed to putting on a meaningful and enriching experience for all delegates.",
      },
    ],
  },
  {
    slug: "harvard-debate-council",
    url: "https://www.harvarddebate.org/programs/ndt-team",
    facts: [
      {
        field: "club.experience_required",
        value: "No prior debate experience required",
        quote:
          "Any Harvard College student with an interest in debate is welcome to join the team — no prior debate experience is required, only a passion for ideas, a willingness to work hard, and a desire to engage with the most challenging policy questions of our time.",
      },
    ],
  },
  {
    slug: "harvard-college-debating-union",
    url: "https://www.harvardcollegedebatingunion.org/join",
    facts: [
      {
        field: "club.experience_required",
        value: "No previous debate experience necessary",
        quote:
          "No previous debate experience is necessary — only intellectual promise and demonstrated commitment to the team.",
      },
    ],
  },
  {
    slug: "harvard-college-debating-union",
    url: "https://www.harvardcollegedebatingunion.org/",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly general meetings",
        quote: "We train together, with weekly general meetings, practice rounds, and casing sessions.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-mock-trial",
    url: "https://www.harvardundergraduatemocktrial.org/trying-out",
    facts: [
      {
        field: "club.experience_required",
        value: "No mock trial experience necessary",
        quote:
          "Our fall tryout process is open to any student at Harvard College. No Mock Trial experience necessary! All grades encouraged to tryout!",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-mock-trial",
    url: "https://www.harvardundergraduatemocktrial.org/tryout-frequently-asked-questions",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["fall"],
        quote: "We can only host tryouts in the fall because we are busy preparing for the post-season in the spring.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-effective-altruism",
    url: "https://harvardundergradea.org/join",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["fall", "spring"],
        quote: "Fellowship applications open in January for Spring and will re-open in September for Fall cohorts.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-faith-and-action",
    url: "https://www.harvardundergraduatefaithandaction.org/events",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly large-group meeting (DOXA) on Fridays",
        quote:
          'DOXA is HUFA’s weekly large group meeting. The word "doxa" stems from the ancient Greek word for glory, and we give glory to the Lord during this time through worship, prayer, teaching, and fellowship. We often invite guest speakers, hear testimonies, and follow up the meeting with refreshments and a social at post-DOXA. It is held every Friday from 7:30 – 9:00 pm.',
      },
    ],
  },
  {
    slug: "harvard-college-consulting-group",
    url: "https://www.harvardconsulting.org/faqs",
    facts: [
      {
        field: "club.hours_per_week",
        value: {
          min: 5,
          max: 5,
          qualifier: "member",
        },
        quote:
          "Most analysts spend on average five hours per week on casework, though it may vary a bit from week-to-week depending on the nature of the assignment.",
      },
      {
        field: "club.meeting_frequency",
        value: "Weekly case team meetings",
        quote:
          "You’ll join your case team during the weekly case team meeting and seamlessly be integrated into the HUCG community at large.",
      },
    ],
  },
  {
    slug: "harvard-college-consulting-group",
    url: "https://www.harvardconsulting.org/application-process",
    facts: [
      {
        field: "club.experience_required",
        value: "No prior consulting experience needed",
        quote:
          "Our analyst classes each semester consist of students from a wide range of backgrounds, and most people come into HUCG with no clue of what consulting even is, much less having actual prior experience in it.",
      },
    ],
  },
  {
    slug: "harvard-financial-analysts-club",
    url: "https://www.harvardfac.org/comp-1",
    facts: [
      {
        field: "club.experience_required",
        value: "No experience necessary",
        quote:
          "No experience necessary! Our mission is to educate, mentor and democratize learning to the next generation of Harvard students.",
      },
    ],
  },
  {
    slug: "harvard-investment-association",
    url: "https://www.harvardinvestmentsassociation.org/the-hia-comp",
    facts: [
      {
        field: "club.experience_required",
        value: "No prior finance experience needed",
        quote:
          "The program is intentionally accessible to students with no prior finance experience, while remaining engaging and substantive for those with previous exposure.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-quantitative-traders",
    url: "https://www.huqt.com/apply",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["spring"],
        quote: "Applications open in the spring.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-economics-association",
    url: "https://www.thehuea.org/get-involved",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote: "Joining HUEA just means getting on our list: no application, résumé, or comp required.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-marketing-group",
    url: "https://harvardundergraduatemarketing.com/comp-portal",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote:
          "Not looking to comp? General members have access to HUMG’s speaker events, panels, and select opportunities. No application required.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-data-analytics-group",
    url: "https://harvardanalytics.org/analysts",
    facts: [
      {
        field: "club.experience_required",
        value: "No prior data science experience needed",
        quote:
          "we welcome a variety of technical backgrounds. So whether you’re just getting started in computer science, statistics, and the general data science scene, or if you’re already passionate about data science, we have a case team for you",
      },
    ],
  },
  {
    slug: "harvard-college-ventures",
    url: "https://www.harvardventures.org/faq",
    facts: [
      {
        field: "club.experience_required",
        value: "No venture experience needed",
        quote:
          "Do I have to be a founder to join Harvard Ventures? Absolutely not! Harvard Ventures welcomes all students, regardless of their experience in venture.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-women-in-computer-science",
    url: "https://wicsatharvard.com/community",
    facts: [
      {
        field: "club.freshmen_eligible",
        value: true,
        quote: "Anyone in their first or second year must complete WiCS comp to become an official WiCS member.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-women-in-business",
    url: "https://huwib.com/home",
    facts: [
      {
        field: "club.member_count",
        value: {
          kind: "range",
          min: 400,
          max: null,
        },
        quote:
          "Harvard Undergraduate Women in Business (HUWIB) is a community of over 400 undergraduate women dedicated to empowering one another to lead and make an impact across industries.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-open-data-project",
    url: "https://hudp.org/join",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["fall", "spring"],
        quote:
          "We run a completion-based comp during both the fall and spring semesters with dedicated tracks for all experience levels.",
      },
      {
        field: "club.experience_required",
        value: "No experience necessary; comp tracks for all experience levels",
        quote:
          "We run a completion-based comp during both the fall and spring semesters with dedicated tracks for all experience levels.",
      },
    ],
  },
  {
    slug: "harvard-din-and-tonics",
    url: "https://dins.com/audition",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["fall"],
        quote: "The Din & Tonics hold auditions each fall and occasionally spring.",
      },
      {
        field: "club.experience_required",
        value: "All levels of experience encouraged to audition",
        quote: "No appointment needed; just show up! All levels of experience are encouraged to audition!",
      },
    ],
  },
  {
    slug: "harvard-chess-club",
    url: "https://harvardcrimsonches.wixsite.com/harvardchess/",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly",
        quote:
          "We welcome players and students of all strengths to our weekly meetings, where we teach, study, and play in a casual setting.",
      },
      {
        field: "club.experience_required",
        value: "Players of all strengths welcome",
        quote:
          "We welcome players and students of all strengths to our weekly meetings, where we teach, study, and play in a casual setting.",
      },
    ],
  },
  {
    slug: "noteables",
    url: "https://college.harvard.edu/student-life/student-stories/finding-fun-and-friends-through-extracurriculars-harvard-noteables",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote: "Noteables is a non-audition show-choir -- anyone is welcome to join, no matter their experience.",
      },
      {
        field: "club.experience_required",
        value: "No experience necessary",
        quote: "Noteables is a non-audition show-choir -- anyone is welcome to join, no matter their experience.",
      },
      {
        field: "club.meeting_frequency",
        value: "Rehearses twice a week",
        quote: "We practice singing and choreography twice a week.",
      },
      {
        field: "club.hours_per_week",
        value: {
          min: 4,
          max: 4,
          qualifier: "member",
        },
        quote: "These four hours of rehearsal a week are my time away from anything academic.",
      },
    ],
  },
  {
    slug: "harvard-radcliffe-dramatic-club",
    url: "https://hrdctheater.org/faq-for-actors/",
    facts: [
      {
        field: "club.experience_required",
        value: "No previous theater experience necessary",
        quote: "Any Harvard undergraduate can audition, no previous theater experience is necessary.",
      },
    ],
  },
  {
    slug: "harvard-radcliffe-dramatic-club",
    url: "https://hrdctheater.org/get-involved/common-casting/",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["fall", "spring"],
        quote: "Common Casting takes place the first week/weekend of every semester.",
      },
    ],
  },
  {
    slug: "harvard-pops-orchestra",
    url: "https://www.harvardpops.com/policies.html",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly rehearsal on Tuesdays",
        quote: "Rehearsal is held every Tuesday from 4:15–6:30 PM in Lowell Lecture Hall.",
      },
    ],
  },
  {
    slug: "harvard-radcliffe-orchestra",
    url: "https://harvardradcliffeorchestra.org/faq",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Twice weekly: Monday evenings and Friday afternoons",
        quote:
          "HRO rehearses every Monday evening from 7:00 to 9:30pm and every Friday afternoon from 3:00 to 5:30pm throughout the academic year",
      },
      {
        field: "club.recruiting_seasons",
        value: ["fall"],
        quote: "Auditions are held once a year, a few days before classes begin in the fall.",
      },
    ],
  },
  {
    slug: "harvard-university-band",
    url: "https://harvardband.org/auditions",
    facts: [
      {
        field: "club.recruiting_seasons",
        value: ["fall"],
        quote: "Auditions are scheduled early each Fall.",
      },
    ],
  },
  {
    slug: "harvard-university-band",
    url: "https://harvardband.org/join-the-band",
    facts: [
      {
        field: "club.experience_required",
        value: "No instrument needed",
        quote: "And you don’t need to play an instrument to become a Bandie.",
      },
    ],
  },
  {
    slug: "harvard-asian-american-dance-troupe",
    url: "https://www.harvardundergraduateaadt.org/join-us",
    facts: [
      {
        field: "club.experience_required",
        value: "No prior experience required",
        quote:
          "AADT has no comp process, and prides itself on being open to any member of the Harvard community regardless of race, gender identity, or prior experience!",
      },
    ],
  },
  {
    slug: "harvard-outing-club-inc",
    url: "https://www.harvardoutingclub.org/about-the-hoc/",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote:
          "Any Harvard affiliate is welcome to join. Membership is $20.00 per semester, which allows you access to all of our gear.",
      },
      {
        field: "club.experience_required",
        value: "No experience necessary",
        quote: "Absolutely no experience is necessary, so even if you’ve never hiked before, come on a trip!",
      },
      {
        field: "club.dues",
        value: {
          hasDues: true,
          amountUsd: 20,
          note: "$20 per semester; financial aid available",
        },
        quote:
          "Membership is $20.00 per semester, which allows you access to all of our gear. You can pay dues any time, including when you come to the office to borrow gear.",
      },
    ],
  },
  // Second pass, 2026-10-02.
  {
    slug: "apichorus-a-cappella",
    url: "https://www.apichorus.org/audition",
    facts: [
      {
        field: "club.join_mode",
        value: "audition",
        quote: "Auditions are a fun, laid-back way for us to get to know you better as a singer.",
      },
    ],
  },
  {
    slug: "conflux",
    url: "https://confluxcollective.org/About",
    facts: [
      {
        field: "club.experience_required",
        value: "No experience necessary",
        quote: "Interested in Conflux? Join our mailing list—we welcome all students, no experience necessary.",
      },
      {
        field: "club.join_mode",
        value: "open",
        quote: "Interested in Conflux? Join our mailing list—we welcome all students, no experience necessary.",
      },
    ],
  },
  {
    slug: "harvard-college-christian-students",
    url: "https://harvardcollegechristians.com/events",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly Family Time gathering",
        quote:
          "Enjoy a home-cooked meal with the whole HCCS family during our weekly gathering of singing and fellowship in God’s word.",
      },
    ],
  },
  {
    slug: "harvard-college-union-society",
    url: "https://www.theharvardunion.org/",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Thursday and Friday evenings during the term",
        quote: "Our debates and dinners are generally on Thursday and Friday evenings during the term.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-foreign-policy-initiative",
    url: "https://sites.harvard.edu/foreign-policy/join-our-policy-program/",
    facts: [
      {
        field: "club.join_mode",
        value: "comp",
        quote:
          "New associates undergo an immersive comp process that will introduce you to the various facets of being a HUFPI associate.",
      },
      {
        field: "club.recruiting_seasons",
        value: ["fall", "spring"],
        quote:
          "The selective comp is run twice a year (in the Fall and Spring) and more information will be put up here each time we run a recruitment cycle.",
      },
      {
        field: "club.experience_required",
        value: "No particular knowledge required",
        quote:
          "There is no particular student we are looking for – we are more interested in dedication and energy, as well as an ability to think outside the box, than particular knowledge.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-kaizen-club",
    url: "https://harvardcollegekaizenclubcom.wordpress.com/",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote:
          "We take inclusivity very seriously and encourage all Harvard students, – undergraduate, graduate, Ph.d – faculty, and staff to join us in creating healthy, long-term habits.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-cancer-association",
    url: "https://www.joinhuca.org/",
    facts: [
      {
        field: "club.experience_required",
        value: "No prior experience required",
        quote:
          "Our programs are designed to lower barriers to entry and ensure that every student, regardless of prior experience, can find their place in the cancer research ecosystem.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-aerospace-collective-huac-formerly-seds",
    url: "https://harvardaero.org/",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly (team project work)",
        quote: "Team members meet weekly for project work and gather club-wide for professional development events",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-philippine-forum",
    url: "https://philippineforum.weebly.com/what-is-hpf.html",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote: "Absolutely anyone! We invite everyone and anyone to join our pamilya (family)!",
      },
      {
        field: "club.meeting_frequency",
        value: "Monthly study breaks",
        quote:
          "HPF also holds study breaks every month featuring delicious Filipino food and snacks, games, and more fun!",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-vision-global-health-society",
    url: "https://harvardcollegevisionghs.github.io/HarvardVISION.html",
    facts: [
      {
        field: "club.hours_per_week",
        value: { min: 1, max: 1, qualifier: "member" },
        quote: "Time Commitment:1 hour/ week",
      },
    ],
  },
  {
    slug: "harvard-undergraduates-for-bipartisan-solutions",
    url: "https://harvardundergraduatesforbipartisansolutions.org/meetings",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly",
        quote:
          "Every week, we order donuts and welcome an intimate community of 10–20 students in Sever Hall to candidly discuss some of America’s most pressing political issues.",
      },
    ],
  },
  {
    slug: "karate-club-sport",
    url: "https://www.harvardkarate.com/faq",
    facts: [
      {
        field: "club.join_mode",
        value: "open",
        quote:
          "All Harvard affiliates are eligible to attend our classes - you just need to have a valid Harvard ID and MAC membership.",
      },
      {
        field: "club.dues",
        value: { hasDues: false, note: "Classes are free with a valid MAC membership; uniform at own cost" },
        quote: "All of our classes are free for Harvard affiliates who have a valid MAC membership.",
      },
    ],
  },
  {
    slug: "karate-club-sport",
    url: "https://www.harvardkarate.com/classes",
    facts: [
      {
        field: "club.experience_required",
        value: "All levels of experience welcome",
        quote: "All levels of experience welcome!",
      },
    ],
  },
  {
    slug: "organization-of-asian-american-sisters-in-service",
    url: "https://harvardoaasis.com/membership",
    facts: [
      {
        field: "club.join_mode",
        value: "comp",
        quote:
          "Comp takes place over five weeks, and there are three requirements: meeting one-on-one with every current sister, a few group events for you to see what OAASIS is like in a group and get a taste of what OAASIS is all about, and a written application.",
      },
    ],
  },
  {
    slug: "student-astronomers-at-harvard-radcliffe",
    url: "https://sites.harvard.edu/stahr/about/",
    facts: [
      {
        field: "club.meeting_frequency",
        value: "Weekly community dinners on Sundays at 5:30pm",
        quote:
          "Last but definitely not least, we host weekly community dinners for those who just can’t get enough STAHR in the Lowell Private Dining Room Sundays at 5:30pm!",
      },
    ],
  },
  {
    slug: "women-in-ai",
    url: "https://mitharvardwai.github.io/",
    facts: [
      {
        field: "club.experience_required",
        value: "No experience necessary",
        quote: "Beginners and interested individuals with any level of knowledge are welcome!",
      },
    ],
  },
  {
    slug: "small-claims-advisory-service",
    url: "https://masmallclaims.org/about/",
    facts: [
      {
        field: "club.member_count",
        value: { kind: "range", min: 100, max: null },
        quote:
          "We now have over 100 active volunteers helping the citizens of Massachusetts navigate the small claims system directly by phone and by appointment",
      },
    ],
  },
  // College Events Board has no website; the Harvard Gazette's profile of it (2019) states what it does.
  {
    slug: "college-events-board",
    url: "https://news.harvard.edu/gazette/story/2019/11/college-events-board-brings-community-to-student-life-on-campus/",
    facts: [
      {
        field: "club.mission",
        value: "to bring diverse groups of students together and create a campus atmosphere that addresses student needs outside of the classroom",
        quote: "With its mission “to bring diverse groups of students together and create a campus atmosphere that addresses student needs outside of the classroom,” in recent years the CEB has rapidly expanded the scope and scale of its role on campus.",
      },
      { field: "club.long_description", value: "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game.", quote: "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game." },
      { field: "club.activity", value: "Yardfest", quote: "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game." },
      { field: "club.activity", value: "Crimson Jam", quote: "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game." },
      { field: "club.activity", value: "Harvard/Yale Spirit Week", quote: "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game." },
    ],
  },
];
