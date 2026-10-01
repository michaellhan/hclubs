"use client";

import { useEffect, useRef, useState } from "react";
import { LogoPlaceholder } from "./ui";

const DIMS = { sm: "size-8", md: "size-10", lg: "size-14" } as const;

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
  if (!src || failed) return <LogoPlaceholder name={name} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer; remote club images
    <img
      ref={ref}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      onLoad={(e) => unusable(e.currentTarget) && setFailed(true)}
      className={`${DIMS[size]} shrink-0 rounded-lg bg-zinc-100 object-contain p-0.5 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-200 dark:ring-zinc-700`}
    />
  );
}
