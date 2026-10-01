import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { siteUrl } from "./site";

/**
 * Share cards (Open Graph / Twitter) rendered at build time with next/og. One visual
 * language for the site card and every club card: the coral hc mark on near-black, zinc
 * text, coral as the only accent. No Harvard marks or crimson (CLAUDE.md §16, §21).
 * Only the bundled Geist Regular font is used, so builds need no network.
 */
export const OG_SIZE = { width: 1200, height: 630 };

/** Metadata entry for a share card at `path` (resolved against metadataBase). */
export function ogImage(path: string, alt: string) {
  return { url: path, width: OG_SIZE.width, height: OG_SIZE.height, type: "image/png", alt };
}

const BG = "#09090b";
const FG = "#fafafa";
const MUTED = "#a1a1aa";
const FAINT = "#71717a";
const CORAL = "#ff6b4a";

/** "hclubs.app" (host plus any base path) for the card footer. */
export function siteLabel(): string {
  return siteUrl().replace(/^https?:\/\//, "");
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="32" fill={CORAL} />
      <path
        d="M16.5 15v32M16.5 36.5c0-5 3.2-8 7.25-8s7.25 3 7.25 8V47M49.6 31.6a8.25 8.25 0 1 0 0 11.8"
        fill="none"
        stroke="#fff6f0"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Frame({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: BG,
        color: FG,
        padding: "64px 72px",
      }}
    >
      {children}
      <div style={{ display: "flex", fontSize: 30, color: MUTED }}>{footer}</div>
    </div>
  );
}

function Brand({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.3 }}>
      <Mark size={size} />
      <div style={{ fontSize: size * 0.62, letterSpacing: -1, color: FG }}>hclubs</div>
    </div>
  );
}

function FooterUrl() {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <div style={{ width: 12, height: 12, borderRadius: 6, background: CORAL, marginRight: 14 }} />
      <div style={{ display: "flex" }}>{siteLabel()}</div>
    </div>
  );
}

export function siteCard(): ImageResponse {
  return new ImageResponse(
    <Frame footer={<FooterUrl />}>
      <Brand size={88} />
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ fontSize: 76, lineHeight: 1.05, letterSpacing: -2.5 }}>Every Harvard student club</div>
        <div style={{ fontSize: 38, lineHeight: 1.3, color: MUTED, maxWidth: 980 }}>
          How to join, deadlines, and time commitment — searchable in one place.
        </div>
      </div>
    </Frame>,
    OG_SIZE,
  );
}

/** Cut at a word boundary and add an ellipsis. */
export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

export interface ClubCardData {
  name: string;
  acronym: string | null;
  description: string | null;
  chips: string[];
}

export function clubCard(club: ClubCardData): ImageResponse {
  const name = truncate(club.name, 90);
  const nameSize = name.length <= 26 ? 80 : name.length <= 44 ? 68 : name.length <= 64 ? 58 : 50;
  return new ImageResponse(
    <Frame footer={<FooterUrl />}>
      <Brand size={60} />
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 20 }}>
          <div style={{ fontSize: nameSize, lineHeight: 1.08, letterSpacing: -2 }}>{name}</div>
          {club.acronym && club.acronym.length <= 12 && !name.includes(club.acronym) ? (
            <div style={{ fontSize: nameSize * 0.55, color: FAINT }}>{club.acronym}</div>
          ) : null}
        </div>
        {club.description ? (
          <div style={{ fontSize: 34, lineHeight: 1.35, color: MUTED, maxWidth: 1040 }}>
            {truncate(club.description, name.length > 44 ? 115 : 150)}
          </div>
        ) : null}
        {club.chips.length > 0 ? (
          <div style={{ display: "flex", gap: 12 }}>
            {club.chips.map((c) => (
              <div
                key={c}
                style={{
                  display: "flex",
                  fontSize: 26,
                  color: "#e4e4e7",
                  border: "1.5px solid #3f3f46",
                  borderRadius: 10,
                  padding: "6px 16px",
                }}
              >
                {c}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Frame>,
    OG_SIZE,
  );
}
