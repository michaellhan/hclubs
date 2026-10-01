import type { ReactNode } from "react";

/** Long-form text pages (about, methodology). Plain Tailwind, no typography plugin. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl space-y-4 text-[15px] leading-7 text-stone-700 dark:text-stone-300 [&_a]:underline [&_a]:decoration-stone-300 [&_a]:underline-offset-2 hover:[&_a]:text-stone-950 dark:hover:[&_a]:text-white [&_code]:rounded [&_code]:bg-stone-100 [&_code]:px-1 [&_code]:text-[13px] dark:[&_code]:bg-stone-800 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-stone-950 dark:[&_h1]:text-white [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-stone-950 dark:[&_h2]:text-white [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ul]:list-disc [&_ul]:space-y-1">
      {children}
    </article>
  );
}

export function ContactLine({ email, subject }: { email: string | null; subject: string }) {
  return email ? (
    <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}>{email}</a>
  ) : (
    <span>the contact address listed on this page once the site launches</span>
  );
}
