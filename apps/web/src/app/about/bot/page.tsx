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
          requests so unchanged pages cost almost nothing.
        </li>
        <li>
          It never logs in or submits forms, and never solves CAPTCHAs. It doesn&apos;t rotate addresses or disguise
          itself. If a site blocks it, it stops.
        </li>
        <li>It does not crawl Instagram, LinkedIn, Facebook, TikTok, or X.</li>
        <li>
          It keeps a private copy of each page it reads, as evidence. We never publish member rosters, officer names, or
          personal email addresses that appear on those pages.
        </li>
      </ul>

      <h2>Opting out</h2>
      <p>
        To stop the crawler, add this to your site&apos;s <code>robots.txt</code>:
      </p>
      <pre className="overflow-x-auto rounded-lg bg-zinc-100 px-4 py-3 text-[13px] dark:bg-zinc-900">
        {`User-agent: ${CRAWLER_USER_AGENT_PREFIX}\nDisallow: /`}
      </pre>
      <p>
        To have information about your organization corrected or removed, contact{" "}
        <ContactLine email={email} subject={`${CRAWLER_USER_AGENT_PREFIX}: opt-out or removal`} />.
      </p>
    </Prose>
  );
}
