import type { Metadata } from "next";
import Link from "next/link";
import { getStaticIndex } from "@hci/db";
import { ClubFilters, searchLocal } from "@hci/db/local";
import { ContactLine, Prose } from "@/components/prose";
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/meta";
import { contactEmail, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: "What hclubs is, where its data comes from, and how to reach us.",
  path: "/about/",
});

/** About and how it works, in one short page (owner, 2026-10-05: methodology merged in, glossary dropped). */
export default async function AboutPage() {
  const index = await getStaticIndex(db(), new Date());
  // `clubs` is the number the home page and directory show by default (clubs with more than a name);
  // `all` is every club in the index, name-only ones included.
  const count = (hideSparse: boolean) =>
    searchLocal(index.clubs, {
      text: null,
      filters: ClubFilters.parse({ hideSparse }),
      sort: "name",
      offset: 0,
      limit: 1,
      now: new Date(),
    }).total;
  const clubs = count(true);
  const all = count(false);
  const email = contactEmail();
  return (
    <Prose>
      <h1>About {SITE_NAME}</h1>
      <p>
        {SITE_NAME} is a student-built guide to {all} Harvard clubs: what each one does, how to join, and when.{" "}
        {clubs < all ? `The directory shows the ${clubs} that have more than a name. ` : null}
        Everything comes from public pages (club websites, Harvard pages, student newspapers) and from students&apos;
        suggestions, which a person checks first.
      </p>
      <p>
        It&apos;s independent and not affiliated with or endorsed by Harvard. Being listed doesn&apos;t mean a club is
        officially recognized.
      </p>
      <p>
        Something wrong or missing? <Link href="/feedback">Send feedback</Link>, or email{" "}
        <ContactLine email={email} subject={`${SITE_NAME}: correction or removal`} /> for corrections and removal
        requests.
      </p>

      <h2>How it works</h2>
      <ul>
        <li>
          <strong>Sources.</strong> Harvard pages, clubs&apos; own sites and recruiting pages, student newspapers, and
          reviewed student suggestions. A club&apos;s site or Instagram counts as official only once a Harvard page or
          another trusted page links it under the club&apos;s name.
        </li>
        <li>
          <strong>Nothing is guessed.</strong> If no source states something (time commitment, size, dues), we leave it
          out. Each club page lists its sources and when we last saw them.
        </li>
        <li id="conflicts">
          <strong>When sources disagree,</strong> the more official source wins, and for things that change, the more
          recent one. Each club page's Sources section lists what the sources say.
        </li>
        <li id="joining">
          <strong>Joining.</strong> &ldquo;Open membership&rdquo; means a source says anyone can join and none names an
          application, comp, audition or tryout for general members; a selective board doesn&apos;t count. A club that
          says nothing is never counted as a &ldquo;no&rdquo; in filters. A <strong>comp</strong> (short for
          competition) is a few weeks of doing the club&apos;s work, such as writing, coding or case practice, after
          which the club decides who joins; some clubs keep everyone who finishes (&ldquo;no cuts&rdquo;). Some clubs
          call it a <strong>punch</strong> (final clubs and social groups: invitations after a series of events), an{" "}
          <strong>audition</strong> (you perform) or a <strong>tryout</strong> (you play or practice). Open membership
          has none of these.
        </li>
        <li>
          <strong>Deadlines</strong> belong to a semester. Whether a round is open is worked out from its dates on the
          day you look; &ldquo;usually recruits in the fall&rdquo; is a past pattern, not a promise.
        </li>
        <li>
          <strong>AI</strong> helps read clubs&apos; pages, but a fact is kept only when its exact words (numbers and
          dates included) are on the page. It also writes one-line summaries from a club&apos;s own text.
        </li>
        <li>
          <strong>No ratings.</strong> We never estimate how hard a club is to get into. An acceptance rate appears only
          when a club published both how many applied and how many got in.
        </li>
      </ul>
      <p>
        <Link href="/about/bot">How our crawler works</Link> (and how a site can opt out).
      </p>
    </Prose>
  );
}
