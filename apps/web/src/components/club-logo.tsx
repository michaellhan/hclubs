"use client";

import { useEffect, useRef, useState } from "react";
import { LogoPlaceholder } from "./ui";

const DIMS = { sm: "size-8", md: "size-10", lg: "size-14" } as const;
const LOAD_TIMEOUT_MS = 6000;

/**
 * Wide wordmarks and tall banners are unreadable as a square mark, and tiny favicons blur
 * when enlarged. (SVGs without intrinsic size report 0×0 in some browsers; they scale fine.)
 */
const unusable = (img: HTMLImageElement) => {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) return !/\.svg(\?|$)/i.test(img.currentSrc || img.src);
  return w / h > 2 || h / w > 2 || (w < 48 && h < 48);
};

/**
 * A smaller rendition where the host's image CDN offers one (originals reach 1.5 MB for a
 * 56 px mark): Squarespace (`format=300w`), WordPress/Jetpack and Sanity (`w=300`).
 * Other hosts are left as is. PURE.
 */
export function logoSrc(src: string): string {
  try {
    const u = new URL(src);
    const host = u.hostname;
    if (/(^|\.)squarespace-cdn\.com$|^static1\.squarespace\.com$/.test(host)) {
      // Stored URLs often already ask for "1500w"; a 56 px mark never needs more than 300w.
      u.searchParams.set("format", "300w");
      return u.toString();
    }
    if (/^i[0-3]\.wp\.com$|\.wordpress\.com$|^cdn\.sanity\.io$/.test(host)) {
      u.searchParams.delete("fit");
      u.searchParams.delete("resize");
      u.searchParams.set("w", "300");
      return u.toString();
    }
  } catch {
    // not a URL; use as is
  }
  return src;
}

/**
 * A club's logo from its own website, falling back to initials when there's none, it
 * fails to load (hotlinked; club sites move files around), or it isn't square-ish.
 */
export function ClubLogo({ name, src, size = "md" }: { name: string; src: string | null; size?: "sm" | "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  // A prerendered image can finish loading before hydration attaches onLoad/onError.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && unusable(img)) setFailed(true);
  }, [src]);
  // A dead host never errors, it just hangs: once the logo is on screen, give it a few seconds.
  useEffect(() => {
    const img = ref.current;
    if (!img || img.complete || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      timer = setTimeout(() => !img.complete && setFailed(true), LOAD_TIMEOUT_MS);
    });
    io.observe(img);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, [src]);
  if (!src || failed) return <LogoPlaceholder name={name} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer; remote club images
    <img
      ref={ref}
      src={logoSrc(src)}
      alt=""
      // The profile header's logo is above the fold; list logos load as they scroll in.
      loading={size === "lg" ? "eager" : "lazy"}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      onLoad={(e) => unusable(e.currentTarget) && setFailed(true)}
      className={`${DIMS[size]} shrink-0 rounded-lg bg-stone-100 object-contain p-0.5 ring-1 ring-inset ring-stone-200 dark:bg-stone-200 dark:ring-stone-700`}
    />
  );
}
