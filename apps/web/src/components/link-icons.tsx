import { LINK_KIND_LABEL, type LinkKind } from "@hci/core";
import { siteLabel, socialHandle, type LinkBar as LinkBarModel, type RankableLink } from "@hci/db/local";
import type { ReactNode, SVGProps } from "react";

/**
 * Small inline link glyphs (simple, drawn here — no icon font or dependency). All use
 * currentColor so they follow the text color in light and dark mode.
 */
function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

const GLYPHS: Partial<Record<LinkKind, ReactNode>> & { apply: ReactNode; other: ReactNode } = {
  website: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9" />
    </>
  ),
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 10.5V16.5M8 7.6v.1M11.5 16.5v-6M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1 1 2.1 2.6v3.5" />
    </>
  ),
  facebook: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M13.2 21v-8h2.6l.4-3h-3V8.4c0-.9.3-1.4 1.5-1.4h1.6V4.3a19 19 0 0 0-2.3-.1c-2.3 0-3.8 1.4-3.8 3.9V10H7.6v3h2.6v8" />
    </>
  ),
  x: <path d="M4.5 4h4.2l10.8 16h-4.2zM19 4l-5.9 6.8M5 20l6-6.9" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor" />
    </>
  ),
  tiktok: <path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8M14 3.5c.4 2.7 2.2 4.4 5 4.6" />,
  github: (
    <path d="M9 19.5c-4 1.2-4-2-5.6-2.4M15 21.5v-3.4c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.6 3.4 5.6 3.7 5.6 3.7a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.2 10c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2v3.5" />
  ),
  discord: (
    <>
      <path d="M8.5 6.5a14 14 0 0 1 7 0M8 17.5c2.6 1 5.4 1 8 0M8.6 6.4 7.8 5c-1.4.3-2.7.8-3.9 1.5C1.6 10 1 13.4 1.4 16.7a13 13 0 0 0 4.2 2.1l1-1.6M15.4 6.4l.8-1.4c1.4.3 2.7.8 3.9 1.5 2.3 3.5 2.9 6.9 2.5 10.2a13 13 0 0 1-4.2 2.1l-1-1.6" />
      <circle cx="9" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  link_in_bio: (
    <path d="M10 13.5a4 4 0 0 0 5.7.3l3-3a4 4 0 0 0-5.7-5.6l-1.7 1.7M14 10.5a4 4 0 0 0-5.7-.3l-3 3a4 4 0 0 0 5.7 5.6l1.7-1.7" />
  ),
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  newsletter: (
    <>
      <path d="M5 4.5h12a1 1 0 0 1 1 1V18a1.5 1.5 0 0 0 3 0V9h-3M5 4.5a1 1 0 0 0-1 1V18a1.5 1.5 0 0 0 1.5 1.5H19.5" />
      <path d="M7.5 8h7M7.5 11.5h7M7.5 15h4" />
    </>
  ),
  mailing_list: (
    <>
      <path d="M4 12.5 6.5 5h11l2.5 7.5V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M4 12.5h4.5l1 2h5l1-2H20" />
    </>
  ),
  apply: <path d="M7 17 17 7M9 7h8v8" />,
  other: (
    <>
      <path d="M13.5 4.5h6v6M19.5 4.5 11 13" />
      <path d="M17 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8.5A1.5 1.5 0 0 1 6 7h4.5" />
    </>
  ),
};

export function LinkGlyph({ kind, className = "size-[18px]" }: { kind: LinkKind | "apply"; className?: string }) {
  return <Svg className={className}>{GLYPHS[kind as keyof typeof GLYPHS] ?? GLYPHS.other}</Svg>;
}

const SOCIAL: readonly LinkKind[] = ["instagram", "linkedin", "facebook", "x", "youtube", "tiktok", "github"];

/** What a link is, in words: "Instagram (@handle)", the website's host, the email address. */
export function describeLink(l: Pick<RankableLink, "kind" | "url" | "handle" | "label">): string {
  const kind = LINK_KIND_LABEL[l.kind];
  if (l.kind === "website") return siteLabel(l.url) ?? kind;
  if (l.kind === "email") return `Email ${l.handle ?? l.url.replace(/^mailto:/, "")}`;
  if (SOCIAL.includes(l.kind)) {
    const handle = socialHandle(l.url, l.handle);
    return handle ? `${kind} (${handle})` : kind;
  }
  return l.label ? `${kind}: ${l.label}` : kind;
}

/** A link's short visible text, for lists: @handle, host/path, or the address. */
export function linkText(l: Pick<RankableLink, "kind" | "url" | "handle">): string {
  if (l.handle && l.kind !== "email") return l.handle.startsWith("@") ? l.handle : `@${l.handle}`;
  return l.url
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/^mailto:/, "")
    .replace(/\/$/, "");
}

const ICON_BUTTON =
  "inline-flex size-11 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-950 sm:size-9 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-white";

function Target({
  href,
  fixture,
  label,
  className,
  children,
}: {
  href: string;
  fixture: boolean;
  label: string;
  className: string;
  children: ReactNode;
}) {
  if (fixture) {
    // Fixture links point at reserved .invalid hosts: shown, never linked.
    return (
      <span
        role="img"
        aria-label={`${label} (demo link)`}
        title={`${label} — demo link`}
        className={`${className} opacity-60`}
      >
        {children}
      </span>
    );
  }
  const external = !href.startsWith("mailto:");
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      className={className}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** Profile header row: an "Apply" (or "Join") button, then one icon per kind of link. */
export function LinkBar<T extends RankableLink>({
  bar,
  fixture,
  applyText = "Apply",
}: {
  bar: LinkBarModel<T>;
  fixture: boolean;
  /** "Join" reads better for open clubs whose sign-up page is the featured link. */
  applyText?: string;
}) {
  if (!bar.apply && bar.icons.length === 0) return null;
  return (
    <ul aria-label="Club links" className="flex flex-wrap items-center gap-1.5">
      {bar.apply ? (
        <li data-track="apply-click">
          <Target
            href={bar.apply.url}
            fixture={fixture}
            label={`${applyText}${bar.apply.label ? `: ${bar.apply.label}` : ""}`}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-700 sm:h-9 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {applyText}
            <LinkGlyph kind="apply" className="size-4" />
          </Target>
        </li>
      ) : null}
      {bar.icons.map((l) => {
        const label = describeLink(l);
        if (l.kind === "website") {
          return (
            <li key={l.url}>
              <Target
                href={l.url}
                fixture={fixture}
                label={`Website: ${label}`}
                className={`${ICON_BUTTON} sm:w-auto sm:max-w-64 sm:gap-1.5 sm:px-2.5`}
              >
                <LinkGlyph kind="website" />
                <span className="hidden truncate text-sm sm:inline">{label}</span>
              </Target>
            </li>
          );
        }
        return (
          <li key={l.url}>
            <Target href={l.url} fixture={fixture} label={label} className={ICON_BUTTON}>
              <LinkGlyph kind={l.kind} />
            </Target>
          </li>
        );
      })}
    </ul>
  );
}

/** Tiny website/Instagram icons for directory rows; sit above the row's stretched link. */
export function QuickLinks({
  links,
  name,
}: {
  links: { website: string | null; instagram: string | null };
  name: string;
}) {
  if (!links.website && !links.instagram) return null;
  const cls =
    "relative z-10 inline-flex size-10 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 sm:size-7 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";
  return (
    <span className="-my-2 -mr-2 flex shrink-0 flex-col items-center self-start sm:my-0 sm:mr-0 sm:flex-row sm:self-center">
      {links.website ? (
        <a
          href={links.website}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
          aria-label={`${name} website (${siteLabel(links.website) ?? "opens in a new tab"})`}
          title={siteLabel(links.website) ?? "Website"}
        >
          <LinkGlyph kind="website" className="size-4" />
        </a>
      ) : null}
      {links.instagram ? (
        <a
          href={links.instagram}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
          aria-label={`${name} on Instagram (${socialHandle(links.instagram) ?? "opens in a new tab"})`}
          title={`Instagram (${socialHandle(links.instagram) ?? ""})`}
        >
          <LinkGlyph kind="instagram" className="size-4" />
        </a>
      ) : null}
    </span>
  );
}
