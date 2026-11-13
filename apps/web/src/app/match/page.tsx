import type { Metadata } from "next";
import { ResumeMatch } from "@/components/resume-match";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Clubs for your resume",
  description:
    "Add your resume and see Harvard clubs that match what you've done. Matching runs in your browser; interactions may be captured in session replay.",
  path: "/match/",
});

export default function MatchPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <ResumeMatch />
    </div>
  );
}
