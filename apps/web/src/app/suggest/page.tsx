import type { Metadata } from "next";
import { SuggestRedirect } from "@/components/suggest-redirect";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Suggest an update",
  description: "Add or correct information about a Harvard club.",
  path: "/suggest/",
  noindex: true,
});

/** Suggestions moved into the feedback page; old links keep their club and topic. */
export default function SuggestPage() {
  return <SuggestRedirect />;
}
