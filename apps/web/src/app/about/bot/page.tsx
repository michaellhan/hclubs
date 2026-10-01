import type { Metadata } from "next";
import { ContactLine, Prose } from "@/components/prose";
import { contactEmail, CRAWLER_USER_AGENT_PREFIX, SITE_NAME } from "@/lib/site";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Our crawler",
  description: `How ${CRAWLER_USER_AGENT_PREFIX} fetches pages, and how to opt out.`,
  path: "/about/bot/",
});

export default function BotPage() {
  const email = contactEmail();
  return (
    <Prose>
      <h1>{CRAWLER_USER_AGENT_PREFIX}</h1>
      <p>
        {CRAWLER_USER_AGENT_PREFIX} is the crawler behind {SITE_NAME}. It reads public Harvard directory pages and the
        public websites of student organizations so club information can link back to its source.
      </p>

      <h2>How it behaves</h2>
      <ul>
        <li>
          It identifies itself honestly with a user agent that starts with <code>{CRAWLER_USER_AGENT_PREFIX}/</code>.
        </li>
        <li>
          It obeys <code>robots.txt</code>, including <code>Crawl-delay</code>, and re-reads it daily.
        </li>
        <li>
          It fetches one page at a time per site, at least two seconds apart. It backs off on errors and honors{" "}
          <code>Retry-After</code>.
        </li>
        <li>
          It crawls shallowly: a handful of pages per club site (home, about, join, recruiting). It uses conditional
          requests so unchanged pages cost almost nothing, and skips cart, account and login pages.
        </li>
        <li>
          It rechecks a page only when it&apos;s due: club home pages about monthly, Harvard directories weekly, and
          joining pages more often while clubs are recruiting.
        </li>
        <li>
          For the few pages that show nothing without JavaScript, it may render the page in a browser — with the same
          user agent, after the same <code>robots.txt</code> check.
        </li>
        <li>
          For application forms linked from a club&apos;s site, it reads only the form&apos;s public title and
          description. It never fills in or submits a form.
        </li>
        <li>
          It never logs in or submits forms, and never solves CAPTCHAs. It doesn&apos;t rotate addresses or disguise
          itself. If a site blocks it, it stops.
        </li>
        <li>It does not crawl Instagram, LinkedIn, Facebook, TikTok, or X.</li>
        <li>It keeps a private copy of each page it reads, as evidence. That copy is never published.</li>
      </ul>

      <h2>What appears on {SITE_NAME}</h2>
      <p>
        Short facts about each organization (how to join, deadlines, links, a one-line description), each linked to the
        page it came from, plus page titles in the club&apos;s source list. Not the text of your pages, and never member
        rosters, officer names, or personal email or phone numbers.
      </p>

      <h2>Opting out</h2>
      <p>
        To stop the crawler, add this to your site&apos;s <code>robots.txt</code>:
      </p>
      <pre className="overflow-x-auto rounded-lg bg-stone-100 px-4 py-3 text-[13px] dark:bg-stone-900">
        {`User-agent: ${CRAWLER_USER_AGENT_PREFIX}\nDisallow: /`}
      </pre>
      <p>
        Pages it can no longer fetch stay cited as they were when we last read them, with that date. To have information
        about your organization corrected or removed, contact{" "}
        <ContactLine email={email} subject={`${CRAWLER_USER_AGENT_PREFIX}: opt-out or removal`} />.
      </p>
    </Prose>
  );
}
