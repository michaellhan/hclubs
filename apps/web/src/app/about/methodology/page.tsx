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

export const metadata: Metadata = {
  title: "Methodology",
  description: "How Club Index sources, verifies, and resolves club information.",
};

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
    label: f.label,
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
      <p>
        {SITE_NAME} stores <strong>claims</strong>, not bare values. A claim is one source saying one thing about a
        club, for example &ldquo;the SEAS student-organization page lists this club&apos;s website as X&rdquo; or
        &ldquo;the club&apos;s join page says applications close October 3.&rdquo; Each claim keeps the page it came
        from, when we saw it, the exact quote where there is one, and how it was extracted. What you see on a club page
        is chosen from those claims by a deterministic resolver. Nothing is typed in from memory, and nothing is
        guessed.
      </p>

      <h2>Badges</h2>
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
      <p>
        When sources disagree we keep every version. The resolver shows one and lists the others under &ldquo;Other
        versions.&rdquo; Deleting evidence is never how a conflict gets fixed.
      </p>

      <h2>Source trust</h2>
      <p>
        Sources are ranked by who published them. A club&apos;s own website or social account counts as official only
        once ownership is established: a Harvard page links to it, or an already-established club channel does. An
        Instagram account that merely has a similar name stays unverified.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 uppercase dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Source type</th>
              <th className="px-3 py-2 text-right font-medium">Base confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
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
        admit count for a named semester, and we show it with the <em>Computed</em> badge and its inputs. A label is
        added only with at least 10 applicants: {Object.values(SELECTIVITY_LABEL).join(", ").toLowerCase()}. When a club
        says its process is &ldquo;very competitive,&rdquo; we quote the club; we don&apos;t turn that into a number.
        Having a comp or an application says nothing about how selective it is.
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
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 uppercase dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Applies to</th>
              <th className="px-3 py-2 font-medium">Time scope</th>
              <th className="px-3 py-2 text-right font-medium">Shown as old after</th>
              <th className="px-3 py-2 font-medium">Inference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {fieldRows.map((f) => (
              <tr key={f.key}>
                <td className="px-3 py-1.5">{f.label}</td>
                <td className="px-3 py-1.5 text-zinc-500">{f.scope}</td>
                <td className="px-3 py-1.5 text-zinc-500">{f.temporality}</td>
                <td className="tabular px-3 py-1.5 text-right text-zinc-500">{f.staleAfter} days</td>
                <td className="px-3 py-1.5 text-zinc-500">
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
