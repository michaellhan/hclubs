"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string }) => void; no_onload?: boolean };
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
    </>
  );
}
