"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchResume, readResumeInterests, type ResumeInterest } from "@hci/db/local";
import { ResumeReadError, resumeText } from "@/lib/resume-text";
import { track } from "@/lib/track";
import { useIndex } from "@/lib/use-index";
import { ClubRow } from "./club-row";
import { ListSkeleton } from "./recruiting-now";
import { EmptyState } from "./ui";

const SHOWN = 20;

/** The resume's text (never the file) kept in this browser so coming back keeps the matches. */
const STORE = "hc-resume";

interface Stored {
  text: string;
  fileName: string | null;
  off: string[];
}

function load(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.text !== "string") return null;
    return {
      text: v.text,
      fileName: typeof v.fileName === "string" ? v.fileName : null,
      off: Array.isArray(v.off) ? v.off.filter((k): k is string => typeof k === "string") : [],
    };
  } catch {
    return null;
  }
}

function save(v: Stored) {
  try {
    if (v.text.trim()) localStorage.setItem(STORE, JSON.stringify(v));
    else localStorage.removeItem(STORE);
  } catch {
    // Storage blocked or full: the page still works, it just won't remember.
  }
}

/**
 * Resume → clubs, all in this browser: the file is read here, matched against the static
 * index, and never uploaded. Its text stays in this browser's localStorage until Clear. The visitor sees the interests read from it and can
 * turn any of them off.
 */
export function ResumeMatch() {
  const { data, error: indexError } = useIndex();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  /** The latest file chosen: a slower earlier read never overwrites it. */
  const request = useRef(0);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const v = load();
    if (v) {
      setText(v.text);
      setFileName(v.fileName);
      setOff(new Set(v.off));
    }
    setRestored(true);
  }, []);

  useEffect(() => {
    if (restored) save({ text, fileName, off: [...off] });
  }, [restored, text, fileName, off]);

  const interests: ResumeInterest[] = useMemo(
    () => (data && text.trim() ? readResumeInterests(text, data.clubs) : []),
    [data, text],
  );
  const categoryName = useMemo(() => {
    const names = new Map((data?.categories ?? []).map((c) => [c.slug, c.name]));
    return (slug: string) => names.get(slug) ?? slug;
  }, [data]);
  const picks = useMemo(
    () =>
      data
        ? matchResume(
            data.clubs,
            interests.filter((i) => !off.has(i.key)),
            50,
            categoryName,
          )
        : [],
    [data, interests, off, categoryName],
  );

  async function choose(file: File | undefined) {
    if (!file) return;
    const id = ++request.current;
    setError(null);
    setReading(true);
    try {
      const read = await resumeText(file);
      if (id !== request.current) return;
      setText(read);
      setFileName(file.name);
      resetChoices();
      track("resume-match", { oncePerPage: true });
    } catch (e) {
      if (id !== request.current) return;
      setError(e instanceof ResumeReadError ? e.message : "That file couldn't be read. Paste the text below instead.");
      setPasteOpen(true);
    } finally {
      if (id === request.current) setReading(false);
      // Choosing the same file again (after an error) must fire onChange.
      if (input.current) input.current.value = "";
    }
  }

  /** A new resume starts with every interest on and the short list. */
  function resetChoices() {
    setOff(new Set());
    setShowAll(false);
  }

  function clear() {
    request.current++;
    setReading(false);
    setText("");
    setFileName(null);
    setError(null);
    resetChoices();
  }

  const toggle = (key: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Clubs for your resume</h1>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          // Moving over the label's own text isn't leaving it.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void choose(e.dataTransfer.files[0]);
        }}
        className={`mt-6 flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm focus-within:ring-2 focus-within:ring-accent ${
          dragging
            ? "border-accent bg-accent/5"
            : "border-stone-300 hover:border-stone-400 dark:border-stone-700 dark:hover:border-stone-500"
        }`}
      >
        <input
          ref={input}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="sr-only"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
        <span aria-live="polite" className="font-medium text-stone-800 dark:text-stone-200">
          {reading ? "Reading…" : fileName ? fileName : "Choose a PDF or drop it here"}
        </span>
        <span className="text-stone-500 dark:text-stone-400">
          {fileName ? "Choose another file" : "PDF or text file"}
        </span>
      </label>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <details className="mt-3 text-sm" open={pasteOpen} onToggle={(e) => setPasteOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer text-stone-600 dark:text-stone-400">Or paste the text</summary>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
          }}
          onPaste={resetChoices}
          rows={8}
          aria-label="Resume text"
          placeholder="Paste your resume, or just list what you've done and like…"
          className="mt-2 w-full rounded-lg border border-stone-300 bg-transparent p-3 text-sm dark:border-stone-700"
        />
      </details>

      {indexError ? (
        <p role="alert" className="mt-6 text-sm text-red-700 dark:text-red-400">
          The club list didn&apos;t load. Reload the page to try again.
        </p>
      ) : null}

      {text.trim() && !data && !indexError ? (
        <div className="mt-6">
          <ListSkeleton rows={3} />
        </div>
      ) : null}

      {text.trim() && data ? (
        <section aria-labelledby="interests" className="mt-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="interests" className="font-semibold">
              What we read
            </h2>
            <button type="button" onClick={clear} className="hc-chip-text text-sm">
              Clear
            </button>
          </div>
          {interests.length ? (
            <>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">Tap one to leave it out.</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {interests.map((i) => (
                  <li key={i.key}>
                    <button
                      type="button"
                      aria-pressed={!off.has(i.key)}
                      onClick={() => toggle(i.key)}
                      className="hc-chip text-stone-500 line-through aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-stone-900 aria-pressed:no-underline dark:aria-pressed:text-stone-100"
                    >
                      {i.label}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              We couldn&apos;t find interests we know in that text. Try adding a line about what you like (for example
              &ldquo;coding, debate, a cappella&rdquo;), or{" "}
              <Link href="/clubs" className="hc-chip-text">
                browse every club
              </Link>
              .
            </p>
          )}
        </section>
      ) : null}

      {text.trim() && data && interests.length ? (
        <section aria-labelledby="picks" className="mt-8">
          <h2 id="picks" className="font-semibold">
            Clubs to look at
          </h2>
          {picks.length ? (
            <>
              <ul className="hc-list mt-2">
                {(showAll ? picks : picks.slice(0, SHOWN)).map((p) => (
                  <ClubRow key={p.club.id} club={p.club} why={[p.interests.slice(0, 3).join(", ")]} />
                ))}
              </ul>
              {!showAll && picks.length > SHOWN ? (
                <button type="button" onClick={() => setShowAll(true)} className="hc-chip mt-4">
                  Show {picks.length - SHOWN} more
                </button>
              ) : null}
              <p className="mt-6 text-xs text-stone-500 dark:text-stone-400">
                Matched by the topics and club names in your resume, the same way search works. It can miss clubs whose
                pages say little, so{" "}
                <Link href="/clubs" className="hc-chip-text">
                  browse the directory
                </Link>{" "}
                too.
              </p>
            </>
          ) : (
            <EmptyState title="No clubs match the interests you kept">Turn one back on to see clubs again.</EmptyState>
          )}
        </section>
      ) : null}
    </div>
  );
}
