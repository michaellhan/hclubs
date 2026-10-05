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

const MORE = [
  { href: "/about/methodology", title: "Methodology", text: "Where each fact comes from and how we pick between sources." },
  { href: "/about/bot", title: "Our crawler", text: "What we fetch, how politely, and how a site can opt out." },
  { href: "/about/glossary", title: "Club vocabulary", text: "Comp, punch, callback and other Harvard club words." },
];

/** Kept short on purpose (owner, 2026-10-04): the details live on the pages linked below. */
export default async function AboutPage() {
  const index = await getStaticIndex(db(), new Date());
  // The same number the home page and directory show by default (clubs with more than a name).
  const clubs = searchLocal(index.clubs, {
    text: null,
    filters: ClubFilters.parse({ hideSparse: true }),
    sort: "name",
    offset: 0,
    limit: 1,
    now: new Date(),
  }).total;
  const email = contactEmail();
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Prose>
        <h1>About {SITE_NAME}</h1>
        <p>
          {SITE_NAME} is a student-built guide to {clubs} Harvard clubs: what each one does, how to join, and when.
          Everything comes from public pages (club websites, Harvard pages, student newspapers) and from students&apos;
          suggestions, which a person checks first.
        </p>
        <p>
          It&apos;s independent and not affiliated with or endorsed by Harvard. Being listed doesn&apos;t mean a club
          is officially recognized.
        </p>
        <p>
          Something wrong or missing? <Link href="/feedback">Send feedback</Link>, or email{" "}
          <ContactLine email={email} subject={`${SITE_NAME}: correction or removal`} /> for corrections and removal
          requests.
        </p>
      </Prose>
      <nav aria-label="More about hclubs" className="grid gap-3 sm:grid-cols-3">
        {MORE.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group rounded-xl border border-stone-200 p-4 hover:border-accent hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"
          >
            <span className="flex items-center justify-between font-medium text-stone-900 dark:text-stone-100">
              {m.title}
              <span aria-hidden className="text-accent transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </span>
            <span className="mt-1 block text-sm text-stone-600 dark:text-stone-400">{m.text}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
