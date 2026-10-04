import type { Metadata } from "next";
import Link from "next/link";
import { getIndexStats } from "@hci/db";
import { ContactLine, Prose } from "@/components/prose";
import { db } from "@/lib/db";
import { pluralize } from "@/lib/format";
import { contactEmail, goatcounterEndpoint, SITE_NAME } from "@/lib/site";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: "What hclubs is, where its data comes from, and how to reach us.",
  path: "/about/",
});

/** Kept short on purpose (owner, 2026-10-04): the details live on the methodology page. */
export default async function AboutPage() {
  const stats = await getIndexStats(db());
  const email = contactEmail();
  return (
    <Prose>
      <h1>About {SITE_NAME}</h1>
      <p>
        A student-built index of {pluralize(stats.clubs, "Harvard student organization")}: what each does, how to join,
        and when. Facts come from public pages (club websites, Harvard pages, student newspapers) and reviewed student
        suggestions. Anything we can&apos;t source says <em>Unknown</em>.
      </p>
      <p>
        Not affiliated with or endorsed by Harvard. A listing here doesn&apos;t mean a club is officially recognized.
      </p>
      <p>
        We never log in anywhere, and never publish rosters, officer names or personal contacts.
        {goatcounterEndpoint() ? " Page views are counted without cookies." : null}
      </p>
      <p>
        Corrections or removal requests: <ContactLine email={email} subject={`${SITE_NAME}: correction or removal`} />.
        More: <Link href="/about/methodology">methodology</Link>, <Link href="/about/bot">our crawler</Link>,{" "}
        <Link href="/about/glossary">club vocabulary</Link>.
      </p>
    </Prose>
  );
}
