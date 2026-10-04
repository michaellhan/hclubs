import type { Metadata } from "next";
import { RecruitingRedirect } from "@/components/recruiting-redirect";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Recruiting",
  description: "Harvard student clubs recruiting now, in the directory.",
  path: "/recruiting/",
  noindex: true,
});

/**
 * The recruiting board was retired (ADR 0048): most of the year it listed patterns, not
 * rounds. Old links land on the directory's "Recruiting now" filter, keeping their filters.
 */
export default function RecruitingPage() {
  return <RecruitingRedirect />;
}
