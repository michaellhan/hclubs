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
        value:
          "to bring diverse groups of students together and create a campus atmosphere that addresses student needs outside of the classroom",
        quote:
          "With its mission “to bring diverse groups of students together and create a campus atmosphere that addresses student needs outside of the classroom,” in recent years the CEB has rapidly expanded the scope and scale of its role on campus.",
      },
      {
        field: "club.long_description",
        value:
          "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game.",
        quote:
          "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game.",
      },
      {
        field: "club.activity",
        value: "Yardfest",
        quote:
          "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game.",
      },
      {
        field: "club.activity",
        value: "Crimson Jam",
        quote:
          "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game.",
      },
      {
        field: "club.activity",
        value: "Harvard/Yale Spirit Week",
        quote:
          "Among the largest events the CEB puts on are the annual Yardfest celebration, which draws thousands of students to the Yard for a concert in April; Crimson Jam, a large-scale block party featuring numerous performances and games; and Harvard/Yale Spirit Week, a variety of events related to The Game.",
      },
    ],
  },
  // Empty-profile pass, 2026-10-03: Harvard Gazette, College and Asia Center pages, Crimson articles and club sites, quotes copied from `hci page-text`.
  {
    slug: "crimsonems",
    url: "https://news.harvard.edu/gazette/story/2019/05/crimson-ems-trains-harvard-students-in-cpr-and-other-life-saving-techniques/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Crimson EMS, Harvard’s student-run emergency medical services organization. The group provides EMT training and assists with emergency care at many campus events.",
        quote:
          "It’s partly why she joined Crimson EMS, Harvard’s student-run emergency medical services organization. The group provides EMT training and assists with emergency care at many campus events.",
      },
      {
        field: "club.activity",
        value: "EMT training",
        quote: "The group provides EMT training and assists with emergency care at many campus events.",
      },
    ],
  },
  {
    slug: "datamatch",
    url: "https://www.thecrimson.com/article/2024/2/12/datamatch-launch-2024/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Founded by Harvard students in 1994, Datamatch — which 4,300 Harvard undergraduates used last year — matches compatible students together through a “top secret” algorithm based on a multiple-choice survey.",
        quote:
          "Founded by Harvard students in 1994, Datamatch — which 4,300 Harvard undergraduates used last year — matches compatible students together through a “top secret” algorithm based on a multiple-choice survey.",
      },
      {
        field: "club.activity",
        value: "sponsors free dates at Harvard Square businesses",
        quote:
          "The organization subsequently sponsors free dates at Harvard Square businesses such as Amorino Gelato, Playa Bowls, and Kung Fu Tea.",
      },
    ],
  },
  {
    slug: "expressions-dance-company",
    url: "https://www.thecrimson.com/article/2023/4/11/expressions-dance-company-the-x-factor-2023/",
    facts: [
      {
        field: "club.long_description",
        value:
          "The Harvard Expressions Dance Company is a fully student-operated hip-hop dance group that’s been on campus for over forty years. Each semester, the organization hosts a dance showcase featuring over a dozen dances all choreographed and performed by undergraduates at the College.",
        quote:
          "The Harvard Expressions Dance Company is a fully student-operated hip-hop dance group that’s been on campus for over forty years. Each semester, the organization hosts a dance showcase featuring over a dozen dances all choreographed and performed by undergraduates at the College.",
      },
      {
        field: "club.activity",
        value: "dance showcase",
        quote:
          "Each semester, the organization hosts a dance showcase featuring over a dozen dances all choreographed and performed by undergraduates at the College.",
      },
    ],
  },
  {
    slug: "black-arts-collective",
    url: "https://www.thecrimson.com/article/2022/3/29/black-arts-collective-article/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Sourcing inspiration from the Black Power and Black Art Movements of the 1960s and 1970s, which emphasized empowerment and healing through collective creation, the Black Arts Collective plans to offer an opportunity to foster both community and creative expression.",
        quote:
          "Sourcing inspiration from the Black Power and Black Art Movements of the 1960s and 1970s, which emphasized empowerment and healing through collective creation, the Black Arts Collective plans to offer an opportunity to foster both community and creative expression.",
      },
    ],
  },
  {
    slug: "dharma-harvards-hindu-students-association",
    url: "https://www.thecrimson.com/article/2021/11/15/dharma-diwali-2021/",
    facts: [
      {
        field: "club.activity",
        value: "prayer service and home-cooked dinner",
        quote:
          "Dharma, Harvard’s Hindu students’ association, hosted a prayer service and home-cooked dinner on Saturday evening in celebration of Diwali, the five-day festival of lights celebrated throughout South Asia.",
      },
    ],
  },
  {
    slug: "eritrean-and-ethiopian-students-association",
    url: "https://www.thecrimson.com/article/2025/11/18/ethio-jazz-soiree-2025-feature/",
    facts: [
      {
        field: "club.activity",
        value: "Ethio-Jazz Soiree",
        quote:
          "On Nov. 9, around 200 people packed into the Signet Society for the second annual Ethio-Jazz Soiree, hosted and organized by Harvard’s Eritrean and Ethiopian Students Association (EESA).",
      },
    ],
  },
  {
    slug: "athlete-ally-harvard-college-chapter",
    url: "https://news.harvard.edu/gazette/story/newsplus/finding-unity-through-athletics/",
    facts: [
      {
        field: "club.activity",
        value: "Pride Games",
        quote:
          "During the last year, it organized and promoted several Pride Games, including rugby, softball, women’s soccer, women’s basketball and women’s ice hockey.",
      },
      {
        field: "club.activity",
        value: "weekly study breaks",
        quote: "The Harvard Athlete Ally weekly study breaks have become popular events for all athletes.",
      },
    ],
  },
  {
    slug: "eating-concerns-hotline-and-outreach",
    url: "https://www.thecrimson.com/article/2020/10/23/peer-counseling-group-format/",
    facts: [
      {
        field: "club.activity",
        value: "Body Talk Workshops",
        quote:
          "ECHO has also tailored its Body Talk Workshops — which foster student conversations about combating negative body talk and explore the concept of the “ideal Harvard student” — to an online group format.",
      },
    ],
  },
  {
    slug: "aleph",
    url: "https://www.thecrimson.com/article/2017/9/7/aepi-the-aleph/",
    facts: [
      {
        field: "club.long_description",
        value:
          "The Aleph, named for the first letter of the Hebrew alphabet, will retain its Jewish cultural identity while allowing all students regardless of gender or faith background to participate in its open recruitment process",
        quote:
          "The Aleph, named for the first letter of the Hebrew alphabet, will retain its Jewish cultural identity while allowing all students regardless of gender or faith background to participate in its open recruitment process",
      },
    ],
  },
  {
    slug: "harvard-classical-club",
    url: "https://sites.harvard.edu/classicalclub/about/",
    facts: [
      {
        field: "club.long_description",
        value: "The Classical Club is the home of undergraduate Classical life at Harvard.",
        quote:
          "The Classical Club is the home of undergraduate Classical life at Harvard. Founded in 1885, the Harvard Classical Club is one of the oldest clubs on campus.",
      },
      {
        field: "club.experience_required",
        value: "No experience with the Classics needed",
        quote:
          "From Classics concentrators to students who love Latin or Greek to people who just think it’s fun, all are welcome, regardless of experience with the Classics!",
      },
      {
        field: "club.activity",
        value: "Saturnalia parties",
        quote:
          "From Saturnalia parties to classical movie screenings, the Classical Club is engaged in all things ancient.",
      },
      {
        field: "club.activity",
        value: "the annual Harvard Certamen competition",
        quote:
          "In addition to these events, the Classical Club supports the annual Harvard Certamen competition and Persephone, the Undergraduate Classics Journal.",
      },
      {
        field: "club.activity",
        value: "Persephone, the Undergraduate Classics Journal",
        quote:
          "In addition to these events, the Classical Club supports the annual Harvard Certamen competition and Persephone, the Undergraduate Classics Journal.",
      },
    ],
  },
  {
    slug: "harvard-radcliffe-modern-dance-company",
    url: "https://www.hrmdc.org/about-us.html",
    facts: [
      {
        field: "club.long_description",
        value:
          "We are a contemporary dance group that welcomes a wide variety of dance styles and backgrounds, and we are dedicated to creating and supporting innovative student choreography and performance in an inclusive environment.",
        quote:
          "We are a contemporary dance group that welcomes a wide variety of dance styles and backgrounds, and we are dedicated to creating and supporting innovative student choreography and performance in an inclusive environment.",
      },
      {
        field: "club.activity",
        value: "weekly company classes",
        quote:
          "HRMDC offers members weekly company classes, guest workshops, and the opportunity to perform and choreograph in the company's biannual shows.",
      },
    ],
  },
  {
    slug: "harvard-radcliffe-modern-dance-company",
    url: "https://www.hrmdc.org/auditions.html",
    facts: [
      {
        field: "club.join_mode",
        value: "audition",
        quote:
          "Auditions for our fall 2026 season will be held on Monday, September 14 at 9 PM in the Office for the Arts Director's Studio.",
      },
    ],
  },
  {
    slug: "harvard-radcliffe-science-fiction-association",
    url: "https://en.wikipedia.org/wiki/Harvard%E2%80%93Radcliffe_Science_Fiction_Association",
    facts: [
      {
        field: "club.long_description",
        value:
          "The Harvard–Radcliffe Science Fiction Association (HRSFA) is the undergraduate science fiction association at Harvard University.",
        quote:
          "The Harvard–Radcliffe Science Fiction Association (HRSFA) is the undergraduate science fiction association at Harvard University. Founded in 1986, its purpose is to promote science fiction (and fantasy) and aid in activity of those interested in the genre.",
      },
      {
        field: "club.mission",
        value: "to promote science fiction (and fantasy) and aid in activity of those interested in the genre",
        quote:
          "Founded in 1986, its purpose is to promote science fiction (and fantasy) and aid in activity of those interested in the genre.",
      },
      {
        field: "club.activity",
        value: "organizes Vericon",
        quote:
          "HRSFA also co-sponsors the annual Ig Nobel awards[1] and organizes Vericon,[2] an annual science fiction convention; and it intermittently publishes Fusion, a speculative-fiction literary magazine.",
      },
    ],
  },
  {
    slug: "harvard-radcliffe-asian-american-womxns-association",
    url: "https://college.harvard.edu/student-life/student-stories/cultural-spaces-harvard-asian-american-womxns-association",
    facts: [
      {
        field: "club.long_description",
        value:
          "Broadly, AAWA holds two kinds of events: community-building and dialogue, though the two overlap in many ways.",
        quote:
          "Broadly, AAWA holds two kinds of events: community-building and dialogue, though the two overlap in many ways.",
      },
      {
        field: "club.activity",
        value: "“Sib Program”",
        quote:
          "In terms of community-building, AAWA has a “Sib Program” (which many student organizations at Harvard have), which pairs first- or second-year students with third- or fourth-year students to facilitate a mentoring relationship.",
      },
      {
        field: "club.activity",
        value: "dialogue events",
        quote:
          "The second aspect of what AAWA does is host dialogue events, which aim to spark discussions about the issues that affect our communities.",
      },
    ],
  },
  {
    slug: "harvard-college-student-chapter-of-the-massachusetts-menstrual-equity-coalition",
    url: "https://www.radcliffe.harvard.edu/news-and-ideas/striving-for-a-full-stop-to-period-poverty",
    facts: [
      {
        field: "club.mission",
        value: "to end period poverty statewide",
        quote:
          "They led her to the Harvard chapter of the Massachusetts Menstrual Equity Coalition (MME), a group whose mission it is to end period poverty statewide.",
      },
    ],
  },
  {
    slug: "harvard-community-of-humanists-atheists-and-agnostics",
    url: "https://www.thecrimson.com/article/2016/4/7/godless-congregation/",
    facts: [
      {
        field: "club.long_description",
        value:
          "The Harvard Community of Humanists, Atheists, and Agnostics is a group of undergraduates who gather to discuss various topics as secular thinkers.",
        quote:
          "The Harvard Community of Humanists, Atheists, and Agnostics is a group of undergraduates who gather to discuss various topics as secular thinkers.",
      },
    ],
  },
  {
    slug: "harvard-south-asian-association",
    url: "https://college.harvard.edu/student-life/student-stories/ghungroo-student-led-celebration-south-asian-culture-harvard",
    facts: [
      {
        field: "club.activity",
        value: "a show called Ghungroo",
        quote:
          "Every spring, the South Asian Association produces a show called Ghungroo, which is an enormous celebration of South Asian culture through manifold acts of dance, music, and drama entirely directed, choreographed, and performed by undergraduate students.",
      },
    ],
  },
  {
    slug: "harvard-college-queer-students-association",
    url: "https://www.thecrimson.com/article/2024/4/9/qsa-queer-prom-2024/",
    facts: [
      {
        field: "club.activity",
        value: "annual Queer Prom",
        quote:
          "The Harvard College Queer Student Association held its annual Queer Prom at the Cambridge Queen’s Head Pub on Saturday evening in collaboration with the Office of BGLTQ Student Life.",
      },
    ],
  },
  {
    slug: "harvard-college-pakistani-students-association",
    url: "https://www.thecrimson.com/article/2025/10/27/pakistani-flood-relief-fundraising/",
    facts: [
      {
        field: "club.activity",
        value: "fundraising drives for environmental disasters in Pakistan",
        quote: "HCPSA previously organized fundraising drives for environmental disasters in Pakistan.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-christian-fellowship",
    url: "https://ruf.org/ministry/hucf/",
    facts: [
      {
        field: "club.long_description",
        value:
          "We are a community attempting to give a well-developed, heart-felt witness to the power of Jesus Christ.",
        quote:
          "Welcome to Harvard Undergraduate Christian Fellowship! We are a community attempting to give a well-developed, heart-felt witness to the power of Jesus Christ.",
      },
      {
        field: "club.activity",
        value: "Bible study or weekly campus worship",
        quote: "Join us for Bible study or weekly campus worship!",
      },
      {
        field: "club.meeting_frequency",
        value: "every Tuesday at 7:30PM",
        quote: "Join us every Tuesday at 7:30PM in Sever Hall",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-black-health-advocates",
    url: "https://www.harvardblackhealth.org/",
    facts: [
      {
        field: "club.activity",
        value: "Black Health Matters Conference",
        quote: "8th Annual Black Health Matters Conference",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-breakers-organization",
    url: "https://www.thecrimson.com/article/2016/3/24/harvard-breakers/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Open to the greater community, the Breakers host practices and attend competitions in the area, allowing members to learn breakdancing and popping styles, build a campus community, and immerse themselves in Boston’s breakdancing scene.",
        quote:
          "Open to the greater community, the Breakers host practices and attend competitions in the area, allowing members to learn breakdancing and popping styles, build a campus community, and immerse themselves in Boston’s breakdancing scene.",
      },
      {
        field: "club.activity",
        value: "learn breakdancing and popping styles",
        quote: "allowing members to learn breakdancing and popping styles, build a campus community",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-birding-club",
    url: "https://salatainstitute.harvard.edu/user_events/birdwatching-101/",
    facts: [
      {
        field: "club.activity",
        value: "all-about-birding crash course",
        quote:
          "Join the Harvard Undergraduate Birding Club for an all-about-birding crash course to learn the basics of this awesome hobby!",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-birding-club",
    url: "https://salatainstitute.harvard.edu/user_events/guided-bird-walk-at-fresh-pond/",
    facts: [
      {
        field: "club.activity",
        value: "off-campus bird walk at Fresh Pond",
        quote:
          "Join the Harvard Undergraduate Birding Club for its first off-campus bird walk at Fresh Pond on Sunday, March 8!",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-creative-writing-collective",
    url: "https://www.thecrimson.com/article/2022/4/7/creative-writing/",
    facts: [
      {
        field: "club.long_description",
        value:
          "An organization called the Harvard Creative Writing Collective, founded in the summer of 2021, works to combat the exclusivity of creative writing at Harvard.",
        quote:
          "An organization called the Harvard Creative Writing Collective, founded in the summer of 2021, works to combat the exclusivity of creative writing at Harvard. The group’s mission statement declares a dedication to “creating a radically inclusive community of writers on campus.”",
      },
      {
        field: "club.mission",
        value: "creating a radically inclusive community of writers on campus",
        quote:
          "The group’s mission statement declares a dedication to “creating a radically inclusive community of writers on campus.”",
      },
      {
        field: "club.activity",
        value: "weekly teas and poetry readings",
        quote:
          "HCWC hosts weekly teas and poetry readings, as well as events with guest speakers who work at the intersection of writing and other fields.",
      },
      {
        field: "club.experience_required",
        value: "no experience needed",
        quote:
          "There is no pressure to prepare prior to an event and no experience needed to try your hand at an open mic event or share your writing with the group.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-bhangra",
    url: "https://www.thecrimson.com/article/2019/12/12/awnit-marta/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Harvard’s Bhangra team combines traditional Punjabi dance with contemporary Western hip hop in their performances.",
        quote:
          "Harvard’s Bhangra team combines traditional Punjabi dance with contemporary Western hip hop in their performances.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-food-security-initiative",
    url: "https://www.thecrimson.com/article/2025/11/3/baby-food-drive-cambridge/",
    facts: [
      {
        field: "club.long_description",
        value:
          "HUFSI, a student organization founded last spring, engages in projects with a mission to advocate for “food and nutrition security for the Harvard community and beyond,” according to their website.",
        quote:
          "HUFSI, a student organization founded last spring, engages in projects with a mission to advocate for “food and nutrition security for the Harvard community and beyond,” according to their website.",
      },
      {
        field: "club.activity",
        value: "citywide baby food drive",
        quote:
          "The Harvard Undergraduate Food Security Initiative led a citywide baby food drive over the past two weeks, collecting essential supplies to share with a local homeless shelter for women and children.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-ghungroo",
    url: "https://college.harvard.edu/student-life/student-stories/ghungroo-student-led-celebration-south-asian-culture-harvard",
    facts: [
      {
        field: "club.long_description",
        value:
          "Every spring, the South Asian Association produces a show called Ghungroo, which is an enormous celebration of South Asian culture through manifold acts of dance, music, and drama entirely directed, choreographed, and performed by undergraduate students.",
        quote:
          "Every spring, the South Asian Association produces a show called Ghungroo, which is an enormous celebration of South Asian culture through manifold acts of dance, music, and drama entirely directed, choreographed, and performed by undergraduate students.",
      },
      {
        field: "club.experience_required",
        value: "No prior experience necessary",
        quote:
          "Any undergrad at Harvard can participate, and students from so many different backgrounds and cultures come together to sing, dance, act, or help produce the show -- no prior experience necessary!",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-hawaii-club",
    url: "https://college.harvard.edu/about/news/hawaii-club-hosts-largest-annual-luau",
    facts: [
      {
        field: "club.long_description",
        value:
          "The Hawaii Club brings together Native and Pacific Islander communities in New England, representing Hawaii, Samoa, Tonga, Aotearoa (New Zealand), Tahiti, Micronesia, Melanesia, and beyond.",
        quote:
          "The Hawaii Club brings together Native and Pacific Islander communities in New England, representing Hawaii, Samoa, Tonga, Aotearoa (New Zealand), Tahiti, Micronesia, Melanesia, and beyond.",
      },
      {
        field: "club.activity",
        value: "annual luau",
        quote:
          "The Harvard Undergraduate Hawaii Club hosted its fifth annual luau on March 28, 2026, marking the largest in the organization’s history with over 200 attendees.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-jugglers",
    url: "https://www.thecrimson.com/article/2026/3/13/pop-up-juggling/",
    facts: [
      {
        field: "club.activity",
        value: "pop-up juggling workshop",
        quote:
          "I had woken up bright and early on Saturday morning with the sole purpose of attending the Harvard Undergraduate Juggler’s first pop-up juggling workshop.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-latina-empowerment-and-development",
    url: "https://college.harvard.edu/student-life/student-stories/lead-conference-2026-leading-without-borders",
    facts: [
      {
        field: "club.activity",
        value: "Latina Empowerment and Development (LEAD) Conference",
        quote:
          "The 2026 Latina Empowerment and Development (LEAD) Conference was one of the most meaningful weekends I’ve had at Harvard so far.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-music-in-hospitals-and-nursing-homes-using-entertainment",
    url: "https://sites.google.com/view/harvard-undergraduate-mihnuet/",
    facts: [
      {
        field: "club.long_description",
        value:
          "MIHNUET is a public service program that brings live music from the Harvard community into area hospitals and nursing homes.",
        quote:
          "MIHNUET is a public service program that brings live music from the Harvard community into area hospitals and nursing homes.",
      },
      {
        field: "club.mission",
        value:
          "to build positive relationships between Harvard students and the elderly or ill via the special gift of music",
        quote:
          "The mission of MIHNUET is to build positive relationships between Harvard students and the elderly or ill via the special gift of music.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-music-in-hospitals-and-nursing-homes-using-entertainment",
    url: "https://news.harvard.edu/gazette/story/2014/10/a-minute-with-mihnuet/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Since 1995, Music in Hospitals and Nursing Homes Using Entertainment as Therapy (MIHNUET) has brought undergraduate musicians to 17 different sites in Cambridge and Boston to share the healing gift of music.",
        quote:
          "Since 1995, Music in Hospitals and Nursing Homes Using Entertainment as Therapy (MIHNUET) has brought undergraduate musicians to 17 different sites in Cambridge and Boston to share the healing gift of music.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-stand-up-comics-society",
    url: "https://www.thecrimson.com/article/2024/4/6/comedy-scrut/",
    facts: [
      {
        field: "club.long_description",
        value:
          "HUSUCS prides itself on its inclusive approach to comedy. The stand up society welcomes all Harvard students at each step of the process: their meetings can be attended by any interested student, anyone with an approved set can perform at a show, and the shows themselves are free and open to all.",
        quote:
          "HUSUCS prides itself on its inclusive approach to comedy. The stand up society welcomes all Harvard students at each step of the process: their meetings can be attended by any interested student, anyone with an approved set can perform at a show, and the shows themselves are free and open to all.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-survivor-club",
    url: "https://www.thecrimson.com/article/2025/4/15/season-2-harvard-survivor/",
    facts: [
      {
        field: "club.activity",
        value: "a mini version of the “Survivor” TV show packed into one day",
        quote:
          "Sixteen undergraduates competed in the second annual iteration of the game – a mini version of the “Survivor” TV show packed into one day.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-ukraine-solidarity-group",
    url: "https://www.thecrimson.com/article/2024/9/25/ukrainian-club-at-harvard/",
    facts: [
      {
        field: "club.long_description",
        value:
          "The Harvard Undergraduate Ukraine Solidarity Group, an organization hoping to raise awareness around issues facing Ukrainian people, announced their intention to apply for official recognition from the College on Saturday.",
        quote:
          "The Harvard Undergraduate Ukraine Solidarity Group, an organization hoping to raise awareness around issues facing Ukrainian people, announced their intention to apply for official recognition from the College on Saturday.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-tibetan-cultural-association",
    url: "https://www.thecrimson.com/article/2022/1/24/new-tibetan-culture-group/",
    facts: [
      {
        field: "club.long_description",
        value:
          "A group of students founded the Harvard Undergraduate Tibetan Cultural Association to promote Tibetan culture and awareness this month.",
        quote:
          "A group of students founded the Harvard Undergraduate Tibetan Cultural Association to promote Tibetan culture and awareness this month.",
      },
      {
        field: "club.mission",
        value: "the association aims to bring together Tibetan students on campus in celebration of their heritage",
        quote:
          "Students involved in the group’s formation said the association aims to bring together Tibetan students on campus in celebration of their heritage.",
      },
      {
        field: "club.activity",
        value: "a Tibetan New Year celebration",
        quote:
          "The Tibetan Cultural Association has some events planned for the near future, including a Tibetan New Year celebration in March.",
      },
    ],
  },
  {
    slug: "harvard-undergraduate-task-force-for-asian-american-progressive-advocacy-and",
    url: "https://asiacenter.harvard.edu/announcements/student-organization-spotlight-task-force-asian-american-progressive-advocacy-and",
    facts: [
      {
        field: "club.long_description",
        value: "Originally TAPAS was formed primarily to advocate for an Ethnic Studies department at Harvard.",
        quote: "Originally TAPAS was formed primarily to advocate for an Ethnic Studies department at Harvard.",
      },
    ],
  },
  {
    slug: "harvard-vietnamese-association",
    url: "https://asiacenter.harvard.edu/announcements/second-home-inside-harvard-vietnamese-association",
    facts: [
      {
        field: "club.long_description",
        value:
          "Founded to celebrate and uplift Vietnamese culture on campus, the Harvard Vietnamese Association (HVA) serves as a home for Vietnamese, Vietnamese American, and allied students at Harvard.",
        quote:
          "Founded to celebrate and uplift Vietnamese culture on campus, the Harvard Vietnamese Association (HVA) serves as a home for Vietnamese, Vietnamese American, and allied students at Harvard.",
      },
      {
        field: "club.activity",
        value: "bi-weekly community dinners in Adams House",
        quote:
          "There are “sibfam” or gia đình groupings that pair upperclassmen with first-years, bi-weekly community dinners in Adams House, monthly study breaks, and an active Slack to keep members connected.",
      },
      {
        field: "club.activity",
        value: "monthly study breaks",
        quote:
          "There are “sibfam” or gia đình groupings that pair upperclassmen with first-years, bi-weekly community dinners in Adams House, monthly study breaks, and an active Slack to keep members connected.",
      },
    ],
  },
  {
    slug: "harvard-undergraduates-for-academic-freedom",
    url: "https://www.thecrimson.com/article/2024/4/5/undergraduate-academic-freedom-group/",
    facts: [
      {
        field: "club.long_description",
        value:
          "The group will explore issues related to free inquiry, intellectual diversity, and civil discourse at the College, working parallel to CAFH.",
        quote:
          "The group will explore issues related to free inquiry, intellectual diversity, and civil discourse at the College, working parallel to CAFH.",
      },
    ],
  },
  {
    slug: "indigo-peer-counseling",
    url: "https://camhs.huhs.harvard.edu/resources/peer-counseling/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Indigo Peer Counseling provides support with any issue, including concerns around identity and intersectionality and how race, ethnicity, socioeconomic status, first-gen identity, citizenship status, ability, gender, sexuality, and other identities, singularly and collectively, may inform individual experiences.",
        quote:
          "Indigo Peer Counseling provides support with any issue, including concerns around identity and intersectionality and how race, ethnicity, socioeconomic status, first-gen identity, citizenship status, ability, gender, sexuality, and other identities, singularly and collectively, may inform individual experiences.",
      },
      {
        field: "club.activity",
        value: "Drop-In Counseling",
        quote: "Drop-In Counseling (Thayer Basement B-01) is available 8pm to 11pm.",
      },
    ],
  },
  {
    slug: "kesem-harvard-undergraduate",
    url: "https://news.harvard.edu/gazette/story/2017/09/harvard-students-campers-share-moments-of-joy-beyond-cancers-shadow/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Harvard’s first year as a chapter of Camp Kesem — “magic” in Hebrew, it’s pronounced keh-sem — unfolded last month in the green hills of Western Massachusetts, with a volunteer team of 19 undergrads serving as counselors for 24 children whose parents have battled cancer.",
        quote:
          "Harvard’s first year as a chapter of Camp Kesem — “magic” in Hebrew, it’s pronounced keh-sem — unfolded last month in the green hills of Western Massachusetts, with a volunteer team of 19 undergrads serving as counselors for 24 children whose parents have battled cancer.",
      },
    ],
  },
  {
    slug: "medlife-harvard-college-student-chapter",
    url: "https://college.harvard.edu/student-life/student-stories/my-five-stages-traveling-medlife-service-learning-trip-slt",
    facts: [
      {
        field: "club.activity",
        value: "pop-up clinics in indigenous communities near Riobamba, Ecuador",
        quote:
          "This year, the Harvard chapter assisted local physicians in hosting 3 pop-up clinics in indigenous communities near Riobamba, Ecuador.",
      },
    ],
  },
  {
    slug: "quad-bikes",
    url: "https://sites.google.com/view/quadbikes/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Quad Bikes is Harvard's student-run bike shop! We are located in the basement of Eliot Hall in Cabot House at 51 Shepard St. Our bread and butter is our regular Open Stand workshop where folks can drop into the shop and learn to fix their bikes.",
        quote:
          "Quad Bikes is Harvard's student-run bike shop! We are located in the basement of Eliot Hall in Cabot House at 51 Shepard St. Our bread and butter is our regular Open Stand workshop where folks can drop into the shop and learn to fix their bikes.",
      },
      {
        field: "club.activity",
        value: "educational workshops",
        quote:
          "We also run educational workshops, lead social group rides, and work to build the bike community on campus.",
      },
      {
        field: "club.activity",
        value: "social group rides",
        quote:
          "We also run educational workshops, lead social group rides, and work to build the bike community on campus.",
      },
    ],
  },
  {
    slug: "room-13",
    url: "https://camhs.huhs.harvard.edu/resources/peer-counseling/",
    facts: [
      {
        field: "club.long_description",
        value:
          "Room 13 Peer Counseling provides support for any and all issues, including concerns related to gender, identity, SES, alcohol and drugs, grief, relationships, eating, health, school, and other topics of concern or interest to students.",
        quote:
          "Room 13 Peer Counseling provides support for any and all issues, including concerns related to gender, identity, SES, alcohol and drugs, grief, relationships, eating, health, school, and other topics of concern or interest to students.",
      },
    ],
  },
  {
    slug: "singapore-indonesia-and-malaysia-association",
    url: "https://asiacenter.harvard.edu/announcements/taste-home-how-siama-brings-southeast-asia-harvard",
    facts: [
      {
        field: "club.long_description",
        value:
          "Founded to celebrate Singaporean, Indonesian, and Malaysian cultures on campus, the Singaporean, Indonesian, and Malaysian Association (SIAMA) serves as a home for students from these nations and allies at Harvard.",
        quote:
          "Founded to celebrate Singaporean, Indonesian, and Malaysian cultures on campus, the Singaporean, Indonesian, and Malaysian Association (SIAMA) serves as a home for students from these nations and allies at Harvard.",
      },
      {
        field: "club.activity",
        value: "biweekly dinners",
        quote:
          "Committed to community and cultural visibility, SIAMA hosts biweekly dinners, Pasar Malam night markets, collaborations during Southeast Asia Visibility Week, and casual gatherings featuring Singlish, snacks, and stories from home.",
      },
      {
        field: "club.activity",
        value: "Pasar Malam night markets",
        quote:
          "Committed to community and cultural visibility, SIAMA hosts biweekly dinners, Pasar Malam night markets, collaborations during Southeast Asia Visibility Week, and casual gatherings featuring Singlish, snacks, and stories from home.",
      },
    ],
  },
  {
    slug: "sexual-education-by-harvard-college-students",
    url: "https://www.thecrimson.com/article/2023/11/9/sex-week-2023/",
    facts: [
      {
        field: "club.activity",
        value: "a weeklong series of events dedicated to sexual health and well-being",
        quote:
          "Harvard students gathered last week for the eleventh annual “Sex Week,” a weeklong series of events dedicated to sexual health and well-being, to discuss safer sex and sexual wellness, LGBTQ+ intimacy, and sexual pleasure.",
      },
    ],
  },
  {
    slug: "undergraduate-mariachi-veritas-de-harvard",
    url: "https://college.harvard.edu/student-life/student-stories/harvard-has-mariachi",
    facts: [
      {
        field: "club.long_description",
        value:
          "As an entirely student-run organization, the members of Mariachi Véritas foster a community rooted in their love of mariachi music, their musical talent, and their commitment to helping their peers develop their musical abilities.",
        quote:
          "As an entirely student-run organization, the members of Mariachi Véritas foster a community rooted in their love of mariachi music, their musical talent, and their commitment to helping their peers develop their musical abilities.",
      },
      {
        field: "club.activity",
        value: "fall and spring concerts",
        quote: "The Mariachi holds two concerts annually: their fall and spring concerts.",
      },
    ],
  },
  {
    slug: "wellness-educators",
    url: "https://college.harvard.edu/student-life/student-stories/wellness-harvard",
    facts: [
      {
        field: "club.long_description",
        value:
          "As part of Harvard’s Center for Wellness and Health Promotion, Wellness Educators (dearly nicknamed WEs) are an undergraduate peer education group that engages the Harvard College community in health promotion and helps cultivate all aspects of student health and wellbeing.",
        quote:
          "As part of Harvard’s Center for Wellness and Health Promotion, Wellness Educators (dearly nicknamed WEs) are an undergraduate peer education group that engages the Harvard College community in health promotion and helps cultivate all aspects of student health and wellbeing.",
      },
      {
        field: "club.activity",
        value: "WISP Party Grant program",
        quote:
          "We distribute safer-sex supplies and sleep kits through pop-up events around campus, provide funding for substantial food and non-alcoholic beverages at parties through the WISP Party Grant program, and host fun workshops to support health and wellbeing!",
      },
      {
        field: "club.activity",
        value: "safer-sex supplies and sleep kits through pop-up events around campus",
        quote:
          "We distribute safer-sex supplies and sleep kits through pop-up events around campus, provide funding for substantial food and non-alcoholic beverages at parties through the WISP Party Grant program, and host fun workshops to support health and wellbeing!",
      },
    ],
  },
  {
    slug: "seneca",
    url: "https://www.thecrimson.com/article/2019/4/23/seneca-becomes-iso/",
    facts: [
      {
        field: "club.activity",
        value: "professional workshops",
        quote:
          "They added that the Seneca organizes professional workshops, hosts an annual Women’s Faculty Reception, and participates in Women’s Week in the spring.",
      },
      {
        field: "club.activity",
        value: "annual Women’s Faculty Reception",
        quote:
          "They added that the Seneca organizes professional workshops, hosts an annual Women’s Faculty Reception, and participates in Women’s Week in the spring.",
      },
    ],
  },
];
