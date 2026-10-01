"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/track";

declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string; event?: boolean }) => void; no_onload?: boolean };
  }
}

/**
 * Counts page views with GoatCounter (cookie-free, no personal data). The script is
 * loaded with `no_onload`, so this component makes every count — the first load and each
 * client-side navigation — exactly once per path change. Query strings are left out on
 * purpose: search and filters rewrite the URL on every keystroke.
 */
export function PageViews() {
  const pathname = usePathname();
  useEffect(() => {
    // The full browser path (includes any base path), matching what GoatCounter would record.
    const path = window.location.pathname;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      const count = window.goatcounter?.count;
      if (count) count({ path });
      else if (tries++ < 20) timer = setTimeout(send, 250); // count.js is async; wait up to ~5 s
    };
    send();
    return () => clearTimeout(timer);
  }, [pathname]);
  return null;
}

/**
 * Counts clicks on elements marked `data-track="…"` (Apply buttons, contribution links) as
 * GoatCounter events: the event name only, never the URL or anything about the visitor.
 */
export function ClickEvents() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-track]");
      const name = el?.getAttribute("data-track");
      if (name) track(name);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}

/** GoatCounter's script plus the counter; renders nothing when no endpoint is configured. */
export function Analytics({ endpoint }: { endpoint: string | null }) {
  if (!endpoint) return null;
  return (
    <>
      <script
        async
        src="https://gc.zgo.at/count.js"
        data-goatcounter={endpoint}
        data-goatcounter-settings='{"no_onload": true}'
      />
      <PageViews />
      <ClickEvents />
    </>
  );
}
