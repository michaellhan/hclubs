"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { clubReference } from "@hci/core/browser";
import { ClubPicker, type PickableClub } from "@/components/officer-form";
import { SendButton } from "@/components/send-button";
import { fieldKind, suggestDetails, type SuggestTopic } from "@/lib/suggest";
import { fillFormUrl, mailtoHref } from "@/lib/site";

const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 text-base outline-none placeholder:text-stone-400 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm dark:border-stone-700 dark:bg-stone-900";

function Field({
  label,
  hint,
  value,
  onChange,
  kind,
  autoFocus,
}: {
  label: string;
  hint: string | null;
  value: string;
  onChange: (v: string) => void;
  kind: "url" | "long" | "text";
  autoFocus?: boolean;
}) {
  const id = useId();
  const placeholder = kind === "url" ? "https://" : (hint ?? undefined);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800 dark:text-stone-200">
        {label}
        {kind === "url" && hint ? (
          <span className="ml-1 font-normal text-stone-500 dark:text-stone-400">({hint})</span>
        ) : null}
      </label>
      {kind === "long" ? (
        <textarea
          id={id}
          value={value}
          rows={3}
          maxLength={1000}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          className={`${input} py-2`}
        />
      ) : (
        <input
          id={id}
          type={kind === "url" ? "url" : "text"}
          inputMode={kind === "url" ? "url" : undefined}
          value={value}
          maxLength={300}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          className={`${input} h-11 sm:h-10`}
        />
      )}
    </div>
  );
}

/**
 * The visitor's suggestion, asked on the site and sent from the page to the shared
 * contribution form (ADR 0035, `SendButton`): the club, the form's option for the topic and
 * "Label: value" lines the importer reads. Nothing is stored.
 */
export function SuggestForm({
  clubs,
  topics,
  addKeys,
  fixKeys,
  chipLabel,
  formTemplate,
  email,
  initialClub,
}: {
  clubs: PickableClub[];
  topics: SuggestTopic[];
  addKeys: string[];
  fixKeys: string[];
  chipLabel: Record<string, string>;
  formTemplate: string | null;
  email: string | null;
  /** The club to open on: `?club=`, or the profile the visitor came from. */
  initialClub: string | null;
}) {
  const params = useSearchParams();
  const [slug, setSlug] = useState<string | null>(initialClub);
  const [topicKey, setTopicKey] = useState<string | null>(params.get("topic"));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  const chose = useRef(false);
  // Arriving from a profile chip, the topic is already chosen: show it, not the whole list.
  const [choosing, setChoosing] = useState(!params.get("topic"));
  const club = clubs.find((c) => c.slug === slug) ?? null;
  const topic = topics.find((t) => t.key === topicKey) ?? null;

  // Keep the URL in step so a reload or a shared link reopens the same club and topic.
  useEffect(() => {
    const q = new URLSearchParams();
    if (slug) q.set("club", slug);
    if (topicKey) q.set("topic", topicKey);
    const next = `${window.location.pathname}${q.size ? `?${q}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [slug, topicKey]);

  if (!formTemplate && !email)
    return (
      <p className="rounded-lg border border-stone-200 p-4 text-sm text-stone-600 dark:border-stone-800 dark:text-stone-400">
        Suggestions open soon.
      </p>
    );
  if (!club)
    return (
      <ClubPicker
        clubs={clubs}
        onPick={(s) => {
          setAnswers({}); // another club's answers must never be sent for this one
          setSlug(s);
        }}
        unknownSlug={slug}
        placeholder="Start typing the club's name"
      />
    );

  const details = topic ? suggestDetails(topic, answers, { source, message }) : "";
  const target =
    topic && details
      ? formTemplate
        ? fillFormUrl(formTemplate, club, { clubref: clubReference(club), type: topic.formOption, details })
        : email
          ? mailtoHref(email, `${topic.label}: ${club.name}`, `Club: ${clubReference(club)}\n\n${details}`)
          : null
      : null;

  const chip = (key: string) => (
    <li key={key}>
      <button
        type="button"
        aria-pressed={key === topicKey}
        onClick={() => {
          chose.current = true;
          setTopicKey(key);
          setChoosing(false);
        }}
        className="hc-chip aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-stone-900 dark:aria-pressed:text-stone-100"
      >
        {chipLabel[key] ?? key}
      </button>
    </li>
  );

  return (
    <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">
          <Link href={`/clubs/${club.slug}`} className="hc-link">
            {club.name}
          </Link>
        </h2>
        <button
          type="button"
          onClick={() => {
            setAnswers({});
            setSlug(null);
          }}
          className="hc-chip-text"
        >
          Change club
        </button>
      </div>

      {choosing || !topic ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-stone-900 dark:text-stone-100">
            What do you want to tell us?
          </legend>
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">
              Add or update
            </p>
            <ul className="flex flex-wrap gap-2">{addKeys.map(chip)}</ul>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-stone-500 uppercase dark:text-stone-400">Report</p>
            <ul className="flex flex-wrap gap-2">{fixKeys.map(chip)}</ul>
          </div>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Run this club?{" "}
            <Link href={`/for-clubs?club=${club.slug}`} className="hc-link">
              Update everything at once
            </Link>
          </p>
        </fieldset>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
          <span className="font-medium text-stone-900 dark:text-stone-100">{chipLabel[topic.key] ?? topic.label}</span>
          <button type="button" onClick={() => setChoosing(true)} className="hc-chip-text">
            Change topic
          </button>
        </p>
      )}

      {topic ? (
        <div className="space-y-4 border-t border-stone-100 pt-5 dark:border-stone-800">
          {topic.prompts.map((p, i) => (
            <Field
              key={p.label}
              label={p.label}
              hint={p.hint}
              kind={fieldKind(p.label)}
              value={answers[p.label] ?? ""}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [p.label]: v }))}
              autoFocus={chose.current && i === 0}
            />
          ))}
          {topic.prompts.length === 0 ? (
            <Field
              label="What should we know?"
              hint={null}
              kind="long"
              value={message}
              onChange={setMessage}
              autoFocus={chose.current}
            />
          ) : null}
          <Field
            label="Where did you see this?"
            hint="optional: a page, post or form that shows it"
            kind="url"
            value={source}
            onChange={setSource}
          />
          <p className="text-xs text-stone-500 dark:text-stone-400">
            A link helps us check it faster.
          </p>
          {target ? (
            <SendButton key={target} target={target} track="suggest-submit" />
          ) : (
            <p className="text-sm text-stone-500 dark:text-stone-400">Answer at least one question to continue.</p>
          )}
        </div>
      ) : null}
    </form>
  );
}
