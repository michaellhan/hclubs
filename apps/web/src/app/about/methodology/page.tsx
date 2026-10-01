import type { Metadata } from "next";
import Link from "next/link";
import {
  ACTIVITY_RULES_VERSION,
  CONFIDENCE_VERSION,
  FIELDS,
  MATCHER_VERSION,
  RESOLVER_VERSION,
  SELECTIVITY_LABEL,
  SELECTIVITY_RULESET_VERSION,
  SOURCE_TYPE_LABEL,
  SOURCE_TYPE_TIER,
  STALE_AFTER_DAYS,
  computeConfidence,
  type FieldDefinition,
  type SourceType,
} from "@hci/core";
import { BADGE_META, ProvenanceBadge } from "@/components/provenance";
import { Prose } from "@/components/prose";
import { SITE_NAME } from "@/lib/site";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Methodology",
  description: "How hclubs sources, verifies, and resolves club information.",
  path: "/about/methodology/",
});

const TEMPORALITY: Record<FieldDefinition["temporality"], string> = {
  stable: "Stable",
  time_varying: "Changes over time",
  cycle_scoped: "Per recruiting cycle",
};

// Generated from the field registry so this page can't drift from what the code does.
const fieldRows = (Object.values(FIELDS) as FieldDefinition[])
  .filter((f) => f.key !== "club.name")
  .map((f) => ({
    key: f.key,
    // Two fields share the label "Summary": the club's own one-liner and our rewrite of it.
    label: f.key === "club.summary" ? "Summary (our one-line rewrite of the club's own text)" : f.label,
    scope: f.subjectType === "club" ? "Club" : "Recruiting cycle",
    temporality: TEMPORALITY[f.temporality],
    staleAfter: STALE_AFTER_DAYS[f.volatility],
    inferred: f.allowInferred,
  }));

const tiers = (Object.entries(SOURCE_TYPE_TIER) as [SourceType, number][])
  .filter(([, tier]) => tier > 0)
  .sort((a, b) => a[1] - b[1]);

export default function MethodologyPage() {
  return (
    <Prose>
      <h1>Methodology</h1>
      <h2 id="in-short">In short</h2>
      <ul>
        <li>
          <strong>Where facts come from:</strong> Harvard pages, clubs&apos; own websites and recruiting pages, student
          newspapers, and student reports that a person has reviewed. Never from memory or guesswork.
        </li>
        <li>
          <strong>Why so much says &ldquo;Unknown&rdquo;:</strong> most clubs don&apos;t publish their time commitment,
          size or dues. When no source states a fact, we say so instead of filling it in — and ask anyone who knows to
          tell us.
        </li>
        <li>
          <strong>Checking a fact:</strong> on a club page, tap any fact to see the page it came from and when we last
          saw it there. Every source is listed at the bottom of the page.
        </li>
        <li>
          <strong>When sources disagree:</strong> we keep every version and show the one from the more official, more
          recent source, marked &ldquo;sources differ&rdquo;. <a href="#conflicts">More below</a>.
        </li>
        <li>
          <strong>Dates:</strong> deadlines belong to a semester. &ldquo;Usually recruits in the fall&rdquo; is a
          pattern from past recruiting, never a promise about this term. Open or closed is worked out from the dates on
          the day you look.
        </li>
        <li>
          <strong>AI:</strong> a language model helps read clubs&apos; own pages, but a fact is kept only when the exact
          words appear on the page (numbers and dates included). It also writes one-line summaries from a club&apos;s
          own text and suggests categories, which are labelled as estimates.
        </li>
        <li>
          <strong>No rankings:</strong> we don&apos;t rate clubs or estimate how hard they are to get into. An
          acceptance rate appears only when a club published both how many applied and how many were admitted.
        </li>
        <li>
          <strong>Corrections:</strong> every club page has a &ldquo;Help improve this page&rdquo; form. A person checks
          every answer before it appears. See <Link href="/about">About</Link> for takedowns.
        </li>
      </ul>

      <h2>Claims, not bare values</h2>
      <p>
        {SITE_NAME} stores <strong>claims</strong>, not bare values. A claim is one source saying one thing about a
        club, for example &ldquo;the SEAS student-organization page lists this club&apos;s website as X&rdquo; or
        &ldquo;the club&apos;s join page says applications close October 3.&rdquo; Each claim keeps the page it came
        from, when we saw it, the exact quote where there is one, and how it was extracted. What you see on a club page
        is chosen from those claims by a deterministic resolver.
      </p>

      <h2>Kinds of evidence</h2>
      <p>
        Club pages show facts plainly; tap one to see where it came from, and every source is in the page&apos;s{" "}
        <em>Sources</em> list. Values only students reported are labelled <em>student-reported</em>, and estimated
        categories are labelled as estimates. Behind the scenes every value carries one of these labels:
      </p>
      <ul className="!list-none space-y-2 !pl-0">
        {Object.entries(BADGE_META).map(([badge, meta]) => (
          <li key={badge} className="!ml-0 flex items-start gap-3">
            <span className="w-24 shrink-0">
              <ProvenanceBadge badge={badge as keyof typeof BADGE_META} />
            </span>
            <span className="text-sm">{meta.help}</span>
          </li>
        ))}
      </ul>
      <h2 id="conflicts">When sources disagree</h2>
      <p>
        We keep every version. The resolver shows one: the more official source wins (a club&apos;s own page over a news
        article; a Harvard page over a blog), and for things that change — deadlines, member counts — a more recent
        statement wins. The page then says &ldquo;sources differ&rdquo;, and tapping the fact lists what each source
        says. Deleting evidence is never how a conflict gets fixed; a wrong value is marked rejected, with a reason, and
        can be restored.
      </p>

      <h2>Source trust</h2>
      <p>
        Sources are ranked by who published them. A club&apos;s own website or social account counts as official only
        once ownership is established: a Harvard page links to it, or an already-established club channel does. An
        Instagram account found by searching for the club&apos;s name stays unverified: we still link to it, but nothing
        it says counts as official.
      </p>
      <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs text-stone-500 uppercase dark:bg-stone-900">
            <tr>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Source type</th>
              <th className="px-3 py-2 text-right font-medium">Base confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {tiers.map(([type, tier]) => (
              <tr key={type}>
                <td className="tabular px-3 py-2">{tier}</td>
                <td className="px-3 py-2">{SOURCE_TYPE_LABEL[type]}</td>
                <td className="tabular px-3 py-2 text-right">
                  {computeConfidence({ sourceType: type, extractionMethod: "structured_data", isDirect: true }).toFixed(
                    2,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm">
        Confidence is computed as base (by tier) × extraction method × directness, never assigned by hand. Parsing a
        page scores 0.95; a language model&apos;s answer scores 0.85 and is accepted only with a verbatim quote from the
        page. Anything inferred rather than stated is halved. Independent sources that agree raise the displayed
        confidence.
      </p>

      <h2>Deadlines and semesters</h2>
      <p>
        Recruiting information belongs to a specific semester, for example Fall 2026, not to the club forever. Relative
        dates like &ldquo;next Friday&rdquo; are resolved only against the date we fetched the page, and a date with no
        time is never silently turned into 11:59 PM. Whether a cycle is open is computed from its dates each time you
        load the page.
      </p>

      <h2>Competitiveness</h2>
      <p>
        We never estimate an acceptance rate. A rate appears only when a club published both an applicant count and an
        admit count for a named semester, and we show it next to the two numbers it was computed from. A label is added
        only with at least 10 applicants: {Object.values(SELECTIVITY_LABEL).join(", ").toLowerCase()}. When a club says
        its process is &ldquo;very competitive,&rdquo; we quote the club; we don&apos;t turn that into a number. Having
        a comp or an application says nothing about how selective it is.
      </p>

      <h2>Active or dormant?</h2>
      <p>
        Activity status is an estimate, shown with the reasons behind it. It uses signals like a current Harvard
        listing, a dated recruiting cycle, or a recently updated website. Missing signals lower confidence; they are not
        proof a club is gone.
      </p>

      <h2>Duplicates</h2>
      <p>
        The same club often appears in several directories under slightly different names. We merge records
        automatically only on a strong shared identifier, like the same official website or directory ID. Similar names
        go to a person for review. Every merge is logged and can be undone.
      </p>

      <h2>Fields we track</h2>
      <p className="text-sm">
        &ldquo;Shown as old after&rdquo; is when a Verified value is downgraded to Reported if we haven&apos;t re-seen
        it. Fields marked &ldquo;no inference&rdquo; must be stated by a source.
      </p>
      <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs text-stone-500 uppercase dark:bg-stone-900">
            <tr>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Applies to</th>
              <th className="px-3 py-2 font-medium">Time scope</th>
              <th className="px-3 py-2 text-right font-medium">Shown as old after</th>
              <th className="px-3 py-2 font-medium">Inference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {fieldRows.map((f) => (
              <tr key={f.key}>
                <td className="px-3 py-1.5">{f.label}</td>
                <td className="px-3 py-1.5 text-stone-500">{f.scope}</td>
                <td className="px-3 py-1.5 text-stone-500">{f.temporality}</td>
                <td className="tabular px-3 py-1.5 text-right text-stone-500">{f.staleAfter} days</td>
                <td className="px-3 py-1.5 text-stone-500">
                  {f.inferred ? "allowed, marked Estimate" : "no inference"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Versions</h2>
      <p className="text-sm">
        Every rule is versioned so results can be rebuilt exactly: resolver <code>{RESOLVER_VERSION}</code>, confidence{" "}
        <code>{CONFIDENCE_VERSION}</code>, entity matcher <code>{MATCHER_VERSION}</code>, selectivity{" "}
        <code>{SELECTIVITY_RULESET_VERSION}</code>, activity <code>{ACTIVITY_RULES_VERSION}</code>.
      </p>
      <p>
        Questions or corrections? See <Link href="/about">About</Link>.
      </p>
    </Prose>
  );
}
