/**
 * Which directory tags a profile shows, and how. Tags come from listings (the College
 * directory's flags, SEAS and department lists, Wikipedia's sections), so most repeat the
 * categories in clumsier words ("seas-affiliated", "student club/group", "a cappella
 * groups"). Only labels that say something the categories don't (a PBHA program, a club
 * sport, a final club) are shown. PURE.
 */
const SHOWN_TAGS: Record<string, { label: string; query: string }> = {
  pbha: { label: "PBHA program", query: "pbha" },
  "club sports": { label: "Club sport", query: "club sport" },
  "iop program": { label: "IOP program", query: "iop" },
  "iop coalition": { label: "IOP coalition", query: "iop" },
  "house committee": { label: "House committee", query: "house committee" },
  "pre-orientation program": { label: "Pre-orientation program", query: "pre-orientation" },
  "male final clubs": { label: "Final club", query: "final club" },
  "female final clubs": { label: "Final club", query: "final club" },
  "department sponsored student organization": { label: "Department-sponsored", query: "department sponsored" },
};

export function shownTags(tags: readonly string[]): { label: string; query: string }[] {
  const out = new Map<string, { label: string; query: string }>();
  for (const t of tags) {
    const s = SHOWN_TAGS[t.toLowerCase()];
    if (s) out.set(s.label, s);
  }
  return [...out.values()];
}
