import { z } from "zod";

/**
 * Organizations that ended (ADR 0038), each backed by a public page that says so. The
 * `lifecycle` stage fetches the page (polite fetcher, robots honored), requires every quote
 * to appear verbatim in its text, and only then records the ending: `club.activity_status`
 * "defunct" plus a `club.lifecycle` value naming the successor, if any.
 *
 * A successor is a different organization, never a merge: the old club keeps its own page,
 * name and history, and links forward. A rename of the same organization belongs in the
 * curated list (`rename: true`) instead.
 */
export const LifecycleEntry = z.object({
  /** The organization that ended. */
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  event: z.enum(["dissolved", "replaced"]),
  year: z.number().int().min(1636).max(2100).nullable(),
  /** The indexed organization that took its place (event "replaced"). */
  successorSlug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
  /** The page that states the ending, and the sentences on it that do. */
  evidence: z.object({
    url: z.string().url(),
    quotes: z.array(z.string().min(12)).min(1).max(4),
  }),
});
export type LifecycleEntry = z.infer<typeof LifecycleEntry>;

export const LIFECYCLE_LIST_VERSION = "1";

export const LIFECYCLE_ENTRIES: LifecycleEntry[] = [
  {
    slug: "harvard-undergraduate-council",
    event: "replaced",
    year: 2022,
    successorSlug: "harvard-undergraduate-association",
    evidence: {
      url: "https://en.wikipedia.org/wiki/Harvard_Undergraduate_Council",
      quotes: [
        "student government of Harvard College between 1982 and 2022, until it was abolished by a student referendum",
        "The replacement organization, the Harvard Undergraduate Association",
      ],
    },
  },
  {
    slug: "gamut",
    event: "dissolved",
    year: 2017,
    evidence: {
      url: "https://en.wikipedia.org/wiki/The_Gamut",
      quotes: [
        "The Gamut was a student publication at Harvard University between 1998 and 2017.",
        "We are Closed for Good as of 12/1/2017",
      ],
    },
  },
];
