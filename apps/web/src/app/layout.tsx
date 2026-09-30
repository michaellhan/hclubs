import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Club Index — Harvard student organizations", template: "%s · Club Index" },
  description:
    "Search, compare, and join Harvard student organizations. Evidence-backed: every fact shows its source and how fresh it is.",
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
            ci
          </span>
          Club Index
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
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <footer className="border-t border-zinc-200 py-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 sm:flex-row sm:justify-between">
            <p>An independent student project. Not affiliated with or endorsed by Harvard University.</p>
            <p>Every fact links to its source. Unknown means we don&apos;t have evidence yet.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
