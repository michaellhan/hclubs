"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClubFilters, type IndexClub } from "@hci/db/local";
import { useSearchEngine } from "@/lib/search-engine";
import { missingClubSlug, slugWords } from "@/lib/missing-club";
import { BASE_PATH } from "@/lib/site";
import { useIndex } from "@/lib/use-index";

/**
 * On the 404 page for a /clubs/… link: go to the club when the link only differs in
 * case or separators, otherwise suggest the closest names. Nothing for other paths.
 */
export function MissingClub() {
  const router = useRouter();
  const { data } = useIndex();
  // The search engine loads only here, not with every page's 404 boundary.
  const engine = useSearchEngine();
  const [guess, setGuess] = useState<string | null>(null);
  useEffect(() => setGuess(missingClubSlug(window.location.pathname, BASE_PATH)), []);
  const exact = guess && data ? data.clubs.find((c) => c.slug === guess) : undefined;
  useEffect(() => {
    if (exact) router.replace(`/clubs/${exact.slug}/`);
  }, [exact, router]);
  if (!guess || !data || exact || !engine) return null;
  const close: IndexClub[] = engine.searchLocal(data.clubs, {
    text: slugWords(guess),
    filters: ClubFilters.parse({ includeInactive: true, includeGraduate: true }),
    sort: "relevance",
    offset: 0,
    limit: 3,
    now: new Date(),
  }).clubs;
  if (!close.length) return null;
  return (
    <div className="mt-6 text-left">
      <p className="text-sm font-medium text-stone-700 dark:text-stone-300">Were you looking for</p>
      <ul className="mt-2 space-y-1">
        {close.map((c) => (
          <li key={c.id}>
            <Link href={`/clubs/${c.slug}/`} className="text-accent underline-offset-2 hover:underline">
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Wraps the 404 page's body: for a /clubs/… link that only differs in case or separators it
 * shows a quiet "Looking for that club" line while the index loads and the redirect happens,
 * so the "couldn't find that page" text never flashes before the club opens.
 */
export function MissingClubGate({ children }: { children: React.ReactNode }) {
  const { data, error } = useIndex();
  const [guess, setGuess] = useState<string | null>(null);
  useEffect(() => setGuess(missingClubSlug(window.location.pathname, BASE_PATH)), []);
  const router = useRouter();
  const exact = guess && data ? data.clubs.some((c) => c.slug === guess) : false;
  useEffect(() => {
    if (exact && guess) router.replace(`/clubs/${guess}/`);
  }, [exact, guess, router]);
  if (guess && !error && (!data || exact))
    return (
      <p role="status" className="py-16 text-center text-sm text-stone-600 dark:text-stone-400">
        Looking for that club…
      </p>
    );
  return <>{children}</>;
}
