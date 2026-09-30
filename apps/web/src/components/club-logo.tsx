"use client";

import { useState } from "react";
import { LogoPlaceholder } from "./ui";

const DIMS = { sm: "size-8", md: "size-10", lg: "size-14" } as const;

/**
 * A club's logo from its own website, falling back to initials when there's none or the
 * image fails to load (hotlinked; club sites move files around).
 */
export function ClubLogo({ name, src, size = "md" }: { name: string; src: string | null; size?: "sm" | "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <LogoPlaceholder name={name} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimizer; remote club images
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${DIMS[size]} shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700`}
    />
  );
}
