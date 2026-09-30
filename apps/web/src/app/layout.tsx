import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { feedbackFormUrl, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "Harvard Club Index — every Harvard student organization", template: "%s · Harvard Club Index" },
  description:
    "Search, compare, and join Harvard student organizations: what they do, how to join, deadlines, and time commitment.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 sm:gap-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight whitespace-nowrap">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-md bg-zinc-900 text-[11px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            hci
          </span>
          Harvard Club Index
        </Link>
        <nav className="flex items-center gap-3 overflow-x-auto text-sm text-zinc-600 sm:gap-4 dark:text-zinc-400">
          <Link href="/clubs" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Directory
          </Link>
          <Link href="/recruiting" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Recruiting
          </Link>
          <Link href="/compare" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            Compare
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const feedback = feedbackFormUrl();
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <footer className="border-t border-zinc-200 py-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:justify-between">
            <div className="space-y-1">
              <p>An independent student project. Not affiliated with or endorsed by Harvard University.</p>
              <p>Unknown means we don&apos;t have that information yet.</p>
            </div>
            <nav aria-label="Footer" className="flex gap-4">
              <Link href="/about" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                About
              </Link>
              <Link href="/about/methodology" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Methodology
              </Link>
              <Link href="/about/bot" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Crawler
              </Link>
              {feedback ? (
                <a
                  href={feedback}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  Feedback
                </a>
              ) : null}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
