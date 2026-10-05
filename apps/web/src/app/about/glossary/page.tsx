import type { Metadata } from "next";
import { ClientRedirect } from "@/components/client-redirect";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Club vocabulary",
  description: "Moved to the About page.",
  path: "/about/glossary/",
  noindex: true,
});

/** Merged into /about (owner, 2026-10-05); old links land there. */
export default function GlossaryPage() {
  return <ClientRedirect to="/about/" label="This page moved to" />;
}
