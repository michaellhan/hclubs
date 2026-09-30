import { siteCard } from "@/lib/og";

// The default share card, written once at build time to /og/site.png. A route handler with
// a .png path (not the opengraph-image file convention, which exports an extensionless
// file) so static hosts serve it as image/png, which link-preview crawlers expect.
export const dynamic = "force-static";

export function GET() {
  return siteCard();
}
