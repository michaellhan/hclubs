import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SavedNavLink } from "@/components/save-toggle";
import { CompareTray } from "@/components/compare-tray";
import { Analytics } from "@/components/analytics";
import { SITE_DESCRIPTION, SITE_IMAGE, SITE_TITLE } from "@/lib/meta";
import { feedbackFormUrl, goatcounterEndpoint, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_TITLE, template: "%s · hclubs" },
  applicationName: "hclubs",
  description: SITE_DESCRIPTION,
  // Link previews (iMessage, GroupMe, Slack, Instagram, X). Cards are PNGs built by
  // app/og/**; club pages override with their own card.
  openGraph: {
    images: [SITE_IMAGE],
    type: "website",
    siteName: "hclubs",
    locale: "en_US",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION, images: [SITE_IMAGE] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

const NAV_LINK = "hc-nav-link";

const FOOTER_LINK =
  "inline-flex min-h-11 items-center px-2 hover:text-stone-900 sm:min-h-0 sm:py-1 dark:hover:text-stone-100";

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/85 backdrop-blur dark:border-stone-800 dark:bg-stone-950/85">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-2 px-3 sm:justify-start sm:gap-6 sm:px-4">
        <Link href="/" className="flex h-12 shrink-0 items-center gap-2 font-semibold tracking-tight whitespace-nowrap">
          <svg aria-hidden viewBox="0 0 64 64" className="size-6 shrink-0">
            <circle cx="32" cy="32" r="32" fill="#ff6b4a" />
            <path
              d="M16.5 15v32M16.5 36.5c0-5 3.2-8 7.25-8s7.25 3 7.25 8V47M49.6 31.6a8.25 8.25 0 1 0 0 11.8"
              fill="none"
              stroke="#fff6f0"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          hclubs
        </Link>
        <nav
          aria-label="Main"
          className="flex min-w-0 items-center text-[13px] text-stone-600 sm:gap-2 sm:text-sm dark:text-stone-400"
        >
          <Link href="/clubs" className={NAV_LINK}>
            Directory
          </Link>
          <Link href="/match" className={NAV_LINK}>
            Match
          </Link>
          <Link href="/compare" className={NAV_LINK}>
            Compare
          </Link>
          <SavedNavLink className={NAV_LINK} />
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
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow dark:focus:bg-stone-900"
        >
          Skip to content
        </a>
        <Nav />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:py-8">
          {children}
        </main>
        <footer className="border-t border-stone-200 py-6 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 sm:flex-row sm:justify-between">
            <p>An independent student project, not affiliated with Harvard University.</p>
            <nav aria-label="Footer" className="-mx-2 flex flex-wrap sm:mx-0 sm:shrink-0 sm:flex-nowrap sm:items-start">
              <Link href="/about" className={FOOTER_LINK}>
                About
              </Link>
              {feedback ? (
                <a
                  href={feedback}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${FOOTER_LINK} font-medium text-stone-700 dark:text-stone-300`}
                >
                  Feedback
                </a>
              ) : null}
            </nav>
          </div>
        </footer>
        <CompareTray />
        <Analytics endpoint={goatcounterEndpoint()} />
      </body>
    </html>
  );
}
