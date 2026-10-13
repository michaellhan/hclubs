"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  OFFICER_FORM_OPTION,
  OFFICER_PROCESS_WORD,
  clubReference,
  officerDetails,
  type OfficerAnswers,
  type OfficerProcess,
  type RecruitingSeason,
} from "@hci/core/browser";
import type { suggest as Suggest } from "@hci/db/local";
import { SendButton } from "@/components/send-button";
import { Chevron } from "@/components/ui";
import { useIndex } from "@/lib/use-index";
import { fillFormUrl, mailtoHref } from "@/lib/site";

export type PickableClub = { slug: string; name: string; acronym: string | null };
/** What the club's page shows today, so an officer can see what to correct. */
export type OfficerNow = { about: string | null; joining: string | null; seasons: string | null };
export type OfficerClub = PickableClub & { missing: string[]; now: OfficerNow };

const PROCESSES = Object.keys(OFFICER_PROCESS_WORD) as OfficerProcess[];
const SEASONS: [RecruitingSeason, string][] = [
  ["fall", "Fall"],
  ["spring", "Spring"],
  ["rolling", "Rolling / any time"],
];

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
const input =
  "h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base outline-none placeholder:text-stone-400 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:h-10 sm:text-sm dark:border-stone-700 dark:bg-stone-900";
const choice = "flex min-h-11 items-center gap-2 text-sm sm:min-h-8";

function Question({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const hintId = useId();
  return (
    <fieldset
      aria-describedby={hint ? hintId : undefined}
      className="space-y-2 border-t border-stone-100 pt-4 dark:border-stone-800"
    >
      <legend className="pt-4 text-sm font-medium text-stone-900 dark:text-stone-100">{label}</legend>
      {hint ? (
        <p id={hintId} className="text-xs text-stone-500 dark:text-stone-400">
          {hint}
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "url";
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm text-stone-700 dark:text-stone-300">
        {label}
      </label>
      <input
        id={id}
        type={type}
        inputMode={type === "url" ? "url" : undefined}
        value={value ?? ""}
        placeholder={placeholder}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        className={input}
      />
    </div>
  );
}

/** Pick the club: type-to-search over every indexed club (name or acronym). */
export function ClubPicker({
  clubs,
  onPick,
  unknownSlug,
  placeholder = "Start typing your club's name",
}: {
  clubs: PickableClub[];
  onPick: (slug: string) => void;
  /** A ?club= that matched nothing (an old or mistyped link). */
  unknownSlug: string | null;
  placeholder?: string;
}) {
  const [q, setQ] = useState(unknownSlug ? unknownSlug.replace(/-/g, " ") : "");
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  // The site's own name typeahead (acronyms, nicknames, half-typed words, one-letter slips),
  // loaded on first use; a plain name match covers the moment before it arrives.
  const { data: index } = useIndex(true);
  const [suggest, setSuggest] = useState<typeof Suggest | null>(null);
  useEffect(() => {
    let live = true;
    void import("@hci/db/local").then((m) => live && setSuggest(() => m.suggest));
    return () => {
      live = false;
    };
  }, []);
  const matches = useMemo(() => {
    const text = q.trim();
    if (!text) return [];
    if (index && suggest) {
      const bySlug = new Map(clubs.map((c) => [c.slug, c]));
      return suggest(index.clubs, text, 8).flatMap((s) => bySlug.get(s.club.slug) ?? []);
    }
    const query = norm(text);
    return clubs
      .filter((c) => norm(c.name).includes(query) || norm(c.acronym ?? "").startsWith(query))
      .sort((a, b) => Number(!norm(a.name).startsWith(query)) - Number(!norm(b.name).startsWith(query)))
      .slice(0, 8);
  }, [q, clubs, index, suggest]);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        Which club?
      </label>
      {unknownSlug ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">We couldn&apos;t find that club. Pick it below.</p>
      ) : null}
      <input
        id={id}
        ref={field}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) {
            e.preventDefault();
            onPick(matches[0].slug);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={100}
        className={input}
      />
      <p role="status" className="sr-only">
        {q.trim() ? `${matches.length} ${matches.length === 1 ? "club" : "clubs"} found` : ""}
      </p>
      {matches.length > 0 ? (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {matches.map((c) => (
            <li key={c.slug}>
              <button
                type="button"
                onClick={() => onPick(c.slug)}
                className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-stone-50 dark:hover:bg-stone-900"
              >
                {c.name}
                {c.acronym ? <span className="ml-1.5 text-stone-500">{c.acronym}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 3 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          No club by that name yet.{" "}
          <Link href="/contribute" className="hc-link">
            Tell us about a missing club
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

/**
 * The officer's update form (ADR 0045). Answers become "Label: value" lines for the shared
 * contribution form, sent from the page (`SendButton`); a person reviews them field by
 * field. Nothing is stored.
 */
export function OfficerForm({
  clubs,
  formTemplate,
  email,
}: {
  clubs: OfficerClub[];
  formTemplate: string | null;
  email: string | null;
}) {
  const params = useSearchParams();
  const [slug, setSlug] = useState<string | null>(params.get("club"));
  const [a, setA] = useState<OfficerAnswers>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const picked = useRef(false);
  const club = clubs.find((c) => c.slug === slug) ?? null;
  // After picking a club, keyboard focus continues at its heading, not the top of the page.
  useEffect(() => {
    if (club && picked.current) heading.current?.focus();
  }, [club]);
  const pick = (s: string | null) => {
    picked.current = s !== null;
    setA({}); // another club's answers must never be sent for this one
    setSlug(s);
  };
  const set = <K extends keyof OfficerAnswers>(k: K, v: OfficerAnswers[K]) => setA((prev) => ({ ...prev, [k]: v }));
  const toggle = <T,>(list: T[] | undefined, v: T) =>
    list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v];
  const details = officerDetails(a);

  if (!formTemplate && !email)
    return (
      <p className="rounded-lg border border-stone-200 p-4 text-sm text-stone-600 dark:border-stone-800 dark:text-stone-400">
        Club updates open soon.
      </p>
    );
  if (!club) return <ClubPicker clubs={clubs} onPick={pick} unknownSlug={slug} />;

  const target = formTemplate
    ? fillFormUrl(formTemplate, club, { clubref: clubReference(club), type: OFFICER_FORM_OPTION, details })
    : email
      ? mailtoHref(email, `Club update: ${club.name}`, `Club: ${clubReference(club)}\n\n${details}`)
      : null;

  return (
    <form className="space-y-2" onSubmit={(e) => e.preventDefault()}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {club.name}
        </h2>
        <button type="button" onClick={() => pick(null)} className="hc-chip-text">
          Change club
        </button>
      </div>
      {club.missing.length > 0 ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Your page doesn&apos;t say yet: {club.missing.join(", ")}.{" "}
          <Link href={`/clubs/${club.slug}`} className="hc-link">
            See your page
          </Link>
        </p>
      ) : (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          <Link href={`/clubs/${club.slug}`} className="hc-link">
            See your page
          </Link>{" "}
          and correct anything out of date below.
        </p>
      )}

      {club.now.about || club.now.joining || club.now.seasons ? (
        <dl className="space-y-1 rounded-lg bg-stone-50 p-3 text-sm dark:bg-stone-900">
          <dt className="text-xs font-medium text-stone-500 dark:text-stone-400">Your page says now</dt>
          {club.now.about ? <dd>{club.now.about}</dd> : null}
          {club.now.joining ? <dd>Joining: {club.now.joining}</dd> : null}
          {club.now.seasons ? <dd>{club.now.seasons}</dd> : null}
        </dl>
      ) : null}

      <Question label="How do new general members join?" hint="Not board or staff roles: how someone becomes a member.">
        <label className={choice}>
          <input type="radio" name="access" checked={a.access === "open"} onChange={() => set("access", "open")} />
          Anyone can join: no application, comp or audition
        </label>
        <label className={choice}>
          <input
            type="radio"
            name="access"
            checked={a.access === "process"}
            onChange={() => set("access", "process")}
          />
          There&apos;s a selection process
        </label>
        {a.access === "process" ? (
          <div className="space-y-3 pl-6">
            <div className="flex flex-wrap gap-x-4">
              {PROCESSES.map((p) => (
                <label key={p} className={choice}>
                  <input
                    type="checkbox"
                    checked={a.processes?.includes(p) ?? false}
                    onChange={() => set("processes", toggle(a.processes, p))}
                  />
                  {OFFICER_PROCESS_WORD[p][0]?.toUpperCase()}
                  {OFFICER_PROCESS_WORD[p].slice(1)}
                </label>
              ))}
            </div>
            {a.processes?.length ? null : (
              <p className="text-xs text-amber-700 dark:text-amber-400">Tick at least one.</p>
            )}
            <TextField
              label="Steps, in order"
              value={a.steps}
              onChange={(v) => set("steps", v)}
              placeholder="e.g. application, then interview"
            />
            <TextField
              label="Hours per week during the comp or application"
              value={a.compHours}
              onChange={(v) => set("compHours", v)}
              placeholder="e.g. 4-6"
            />
          </div>
        ) : null}
      </Question>

      <Question label="Can first-years join?">
        <div className="flex gap-4">
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className={choice}>
              <input
                type="radio"
                name="firstYears"
                checked={a.firstYears === v}
                onChange={() => set("firstYears", v)}
              />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </Question>

      <Question label="Time, cost and size">
        <TextField
          label="Hours per week as a member"
          value={a.memberHours}
          onChange={(v) => set("memberHours", v)}
          placeholder="e.g. 2-3"
        />
        <TextField
          label="Dues"
          value={a.dues}
          onChange={(v) => set("dues", v)}
          placeholder="e.g. none, or $40 a semester"
        />
        <TextField
          label="Number of members"
          value={a.members}
          onChange={(v) => set("members", v)}
          placeholder="e.g. about 40"
        />
      </Question>

      <Question label="When do you recruit?">
        <div className="flex flex-wrap gap-x-4">
          {SEASONS.map(([s, label]) => (
            <label key={s} className={choice}>
              <input
                type="checkbox"
                checked={a.seasons?.includes(s) ?? false}
                onChange={() => set("seasons", toggle(a.seasons, s))}
              />
              {label}
            </label>
          ))}
        </div>
        <TextField
          label="Next deadline, if set"
          value={a.deadline}
          onChange={(v) => set("deadline", v)}
          placeholder="e.g. October 20, 11:59 PM"
        />
        {a.deadline ? (
          <TextField
            label="For which term"
            value={a.term}
            onChange={(v) => set("term", v)}
            placeholder="e.g. Fall 2026"
          />
        ) : null}
        <TextField
          label="Application or sign-up link"
          type="url"
          value={a.applicationLink}
          onChange={(v) => set("applicationLink", v)}
          placeholder="https://"
        />
      </Question>

      <Question
        label="Links"
        hint="Your official website and Instagram, and a page or post that says what you told us."
      >
        <TextField
          label="Website"
          type="url"
          value={a.website}
          onChange={(v) => set("website", v)}
          placeholder="https://"
        />
        <TextField
          label="Instagram"
          value={a.instagram}
          onChange={(v) => set("instagram", v)}
          placeholder="@yourclub"
        />
        <TextField
          label="Where this is posted"
          type="url"
          value={a.shownAt}
          onChange={(v) => set("shownAt", v)}
          placeholder="https://"
        />
      </Question>

      <Question
        label="Something here is wrong"
        hint="Anything above, or on your page, that is out of date or incorrect."
      >
        <textarea
          value={a.wrong ?? ""}
          onChange={(e) => set("wrong", e.target.value)}
          rows={2}
          maxLength={1000}
          aria-label="What is wrong on the page"
          placeholder="e.g. We no longer have a comp; we recruit in spring only"
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm dark:border-stone-700 dark:bg-stone-900"
        />
      </Question>

      <Question label="Anything else students should know?">
        <textarea
          value={a.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          maxLength={1000}
          aria-label="Anything else students should know"
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm dark:border-stone-700 dark:bg-stone-900"
        />
      </Question>

      <div className="space-y-3 border-t border-stone-100 pt-4 dark:border-stone-800">
        {details ? (
          <details className="group text-sm" open>
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-stone-600 dark:text-stone-400 [&::-webkit-details-marker]:hidden">
              What we&apos;ll receive
              <Chevron className="group-open:rotate-180" />
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-stone-50 p-3 text-xs whitespace-pre-wrap dark:bg-stone-900">
              {details}
            </pre>
          </details>
        ) : (
          <p className="text-sm text-stone-500 dark:text-stone-400">Answer at least one question to continue.</p>
        )}
        {target && details ? (
          <SendButton key={target} target={target} emailLabel="Email this update" track="officer-submit" />
        ) : null}
      </div>
    </form>
  );
}
