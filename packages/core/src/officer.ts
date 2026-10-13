import type { JoinMode } from "./enum-values";
import type { RecruitingSeason } from "./fields/value-utils";

/**
 * Contribution template labels and the club-officer composer (ADR 0045). Kept free of Zod
 * and the parsers so the browser can build an officer's update (@hci/core/browser); the
 * importer in contribute.ts reads the same labels back. PURE.
 */
export const PROMPT_LABEL = {
  website: "Website",
  instagram: "Instagram",
  applicationLink: "Application link",
  deadline: "Deadline",
  term: "Term",
  howToJoin: "How to join",
  steps: "Steps",
  members: "Number of members",
  dues: "Dues",
  memberHours: "Hours per week as a member",
  compHours: "Hours per week during the comp or application",
  eligibility: "Who can join",
  inactive: "Why it seems inactive",
  newName: "New name",
  oldName: "Old name",
  duplicate: "Same club as",
  does: "What the club does",
  wrong: "What's wrong",
  right: "What it should say",
  channel: "The club's official website or Instagram",
  update: "What to update",
  clubName: "Club name",
  anyLink: "Website or Instagram",
  firstYears: "First-years can join",
  seasons: "Usually recruits",
  shownAt: "Where this is posted",
  notes: "Anything else students should know",
} as const;

/** The live form's "What kind of update?" option for officers (also the club_manager type's). */
export const OFFICER_FORM_OPTION = "I run this club";

/** "Harvard Computer Society [harvard-computer-society]": readable, and the slug survives edits. */
export function clubReference(club: { name: string; slug: string }): string {
  return `${club.name} [${club.slug}]`;
}

export type OfficerProcess = Extract<JoinMode, "application" | "comp" | "audition" | "tryout" | "invite_only">;

/** What a club officer tells us on /for-clubs. Every field is optional. */
export interface OfficerAnswers {
  /** "open": anyone can join; "process": one or more of `processes`. */
  access?: "open" | "process";
  processes?: OfficerProcess[];
  steps?: string;
  firstYears?: "yes" | "no";
  memberHours?: string;
  compHours?: string;
  dues?: string;
  seasons?: RecruitingSeason[];
  deadline?: string;
  term?: string;
  applicationLink?: string;
  members?: string;
  website?: string;
  instagram?: string;
  shownAt?: string;
  notes?: string;
  /** Something the page shows now that is wrong (free text; a person reviews it). */
  wrong?: string;
}

export const OFFICER_PROCESS_WORD: Record<OfficerProcess, string> = {
  application: "application",
  comp: "comp",
  audition: "audition",
  tryout: "tryout",
  invite_only: "invite only",
};

const line = (label: string, value: string | undefined): string | null => {
  const v = value?.replace(/\s+/g, " ").trim();
  return v ? `${label}: ${v}` : null;
};

/**
 * The officer's answers as template lines the importer parses (one per answered question,
 * nothing for blanks), so each answer becomes its own reviewable proposal. PURE.
 */
export function officerDetails(a: OfficerAnswers): string {
  const join =
    a.access === "open"
      ? "open, anyone can join"
      : a.access === "process" && a.processes?.length
        ? a.processes.map((m) => OFFICER_PROCESS_WORD[m]).join(", ")
        : undefined;
  return [
    line(PROMPT_LABEL.howToJoin, join),
    line(PROMPT_LABEL.steps, join && a.access === "process" ? a.steps : undefined),
    line(PROMPT_LABEL.firstYears, a.firstYears),
    line(PROMPT_LABEL.memberHours, a.memberHours),
    line(PROMPT_LABEL.compHours, join && a.access === "process" ? a.compHours : undefined),
    line(PROMPT_LABEL.dues, a.dues),
    line(PROMPT_LABEL.seasons, a.seasons?.length ? a.seasons.join(", ") : undefined),
    line(PROMPT_LABEL.deadline, a.deadline),
    line(PROMPT_LABEL.term, a.deadline ? a.term : undefined),
    line(PROMPT_LABEL.applicationLink, a.applicationLink),
    line(PROMPT_LABEL.members, a.members),
    line(PROMPT_LABEL.website, a.website),
    line(PROMPT_LABEL.instagram, a.instagram),
    line(PROMPT_LABEL.shownAt, a.shownAt),
    line(PROMPT_LABEL.wrong, a.wrong),
    line(PROMPT_LABEL.notes, a.notes),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}
