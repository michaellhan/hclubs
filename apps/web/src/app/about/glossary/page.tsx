import type { Metadata } from "next";
import Link from "next/link";
import { Prose } from "@/components/prose";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Club vocabulary",
  description: "What “comp”, “punch”, “callback”, “board” and other Harvard club-recruiting words mean.",
  path: "/about/glossary/",
});

/** Words a first-year meets on club pages, in plain English. Definitions, not advice. */
const TERMS: { id: string; term: string; def: React.ReactNode }[] = [
  {
    id: "comp",
    term: "Comp",
    def: (
      <>
        Short for &ldquo;competition&rdquo;: a trial period, often a few weeks, in which you learn the club&apos;s work
        and do some of it (write articles, sell ads, build a project) before the club decides. Some comps take everyone
        who finishes; others are selective. Having a comp says nothing by itself about how many people get in.
      </>
    ),
  },
  {
    id: "application",
    term: "Application",
    def: "A written form (short answers, sometimes a résumé), often followed by one or more interviews.",
  },
  {
    id: "audition",
    term: "Audition / callback",
    def: "Performing groups hear you sing, play, dance or act; a callback is a second, shorter round for some of those who auditioned.",
  },
  {
    id: "tryout",
    term: "Tryout",
    def: "For teams and club sports: a practice or skills session the team uses to pick members.",
  },
  {
    id: "open",
    term: "Open membership",
    def: "Anyone can join, usually by signing up for the email list or coming to a meeting. Some open clubs still select leaders or teams later.",
  },
  {
    id: "info-session",
    term: "Info session / coffee chat",
    def: "Recruiting events before an application: a club presentation, or a short one-on-one conversation with a member. Usually optional; the club's page says if not.",
  },
  {
    id: "case-interview",
    term: "Case interview",
    def: "An interview, common in consulting and finance clubs, where you work through a business problem out loud.",
  },
  {
    id: "board",
    term: "Board",
    def: "A club's student leadership (president, treasurer, comp directors…). “Joining the board” is usually separate from joining the club.",
  },
  {
    id: "punch",
    term: "Punch",
    def: "The invitation-only recruiting process of final clubs and some other social organizations: you can't apply, you're invited to events.",
  },
  {
    id: "rolling",
    term: "Rolling",
    def: "Applications are reviewed as they arrive, with no single deadline.",
  },
];

export default function GlossaryPage() {
  return (
    <Prose>
      <h1>Club vocabulary</h1>
      <p>
        Words you&apos;ll see on club pages and in recruiting emails, in plain English. How a specific club works is on
        its own page — these are only the general meanings.
      </p>
      <dl>
        {TERMS.map((t) => (
          <div key={t.id} id={t.id} className="scroll-mt-20">
            <dt className="font-semibold">{t.term}</dt>
            <dd className="mb-4 ml-0">{t.def}</dd>
          </div>
        ))}
      </dl>
      <p>
        See also <Link href="/about/methodology/">how hclubs knows what it says</Link>.
      </p>
    </Prose>
  );
}
