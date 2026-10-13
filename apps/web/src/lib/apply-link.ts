import {
  CLUB_SPORTS_INTEREST_FORM_LABEL,
  isClubSportsInterestForm,
  isFormUrl,
  namedRoundOver,
  openJoinLinkText,
} from "@hci/core/browser";

export interface ApplyLinkState {
  url: string;
  label: string | null;
  /** The term the link's label or form title names ("2026-fall"), unless it is the current round's own link. */
  term: string | null;
  /** The club's current round is open (or has a deadline ahead) on `now`. */
  live: boolean;
  /** The club's current round is closed on `now`. */
  closed: boolean;
  /** The club says anyone can join. */
  open: boolean;
  /** A source names an application, comp, audition or tryout (else the page may just say how to join). */
  hasProcess?: boolean;
}

/**
 * The featured application button's wording and prominence on `now` (null before mount: the
 * build day's state). Prominent only while a round is open or the club is open to everyone. A
 * form from a closed round, or one whose own words name a round already over ("Fall 2026 Comp
 * Interest Form" on Oct 12, 2026; `namedRoundOver`), is only a record: "Last round's form",
 * never "How to apply" (ADR 0051 amendment). PURE.
 */
export function applyLinkText(s: ApplyLinkState, now: Date | null): { text: string; primary: boolean; past: boolean } {
  const pastNamed = !s.live && s.term !== null && now !== null && namedRoundOver(s.term, now);
  const past = s.closed || pastNamed;
  if (s.live) return { text: "Apply", primary: true, past: false };
  if (past) {
    // A closed round's page may still say what comes next; a form is only a record.
    const form = isFormUrl(s.url);
    return {
      text: form ? (s.closed ? "Last round's form (closed)" : "Last round's form") : "See how they recruit",
      primary: false,
      past: true,
    };
  }
  if (s.open) return { text: openJoinLinkText(s.url), primary: true, past: false };
  // The Club Sports Office's shared form, not the club's own: name it everywhere alike.
  if (isClubSportsInterestForm(s.url)) return { text: CLUB_SPORTS_INTEREST_FORM_LABEL, primary: false, past: false };
  // An interest form isn't an application: say what it is (2026-10-12).
  if (s.label && /\binterest form\b/i.test(s.label)) return { text: "Interest form", primary: false, past: false };
  // No application or comp on record (the Democrats' "How to apply" says join the GroupMe).
  if (s.hasProcess === false) return { text: "How to join", primary: false, past: false };
  return { text: "How to apply", primary: false, past: false };
}
