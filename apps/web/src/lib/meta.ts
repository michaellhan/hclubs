import type { Metadata } from "next";
import { ogImage } from "./og";

export const SITE_TITLE = "hclubs — every Harvard student club";
export const SITE_DESCRIPTION =
  "Search, compare, and join Harvard student organizations: what they do, how to join, deadlines, and time commitment.";

export const SITE_IMAGE = ogImage(
  "/og/site.png",
  "hclubs — every Harvard student club: how to join, deadlines, time commitment",
);

/**
 * Per-page metadata: title, description, canonical URL and matching link-preview tags.
 * Without it every page inherits the home page's og:url, so shared links preview as the
 * home page (launch audit). `path` is site-relative with a trailing slash ("/about/").
 */
export function pageMetadata(input: {
  title: string;
  description: string;
  path: string;
  image?: ReturnType<typeof ogImage>;
  noindex?: boolean;
}): Metadata {
  const image = input.image ?? SITE_IMAGE;
  const full = `${input.title} · hclubs`;
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.path },
    openGraph: {
      type: "website",
      siteName: "hclubs",
      locale: "en_US",
      url: input.path,
      title: full,
      description: input.description,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: full, description: input.description, images: [image] },
    ...(input.noindex ? { robots: { index: false } } : {}),
  };
}

/** The home page: the site title as is, canonical "/". */
export const HOME_METADATA: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "hclubs",
    locale: "en_US",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_IMAGE],
  },
};
