"use client";

import { useEffect, useState } from "react";

/**
 * The viewer's current time, or null during prerender/hydration. Pages are built ahead of
 * time, so anything that depends on "now" (open/closed, "in 3 days") renders a neutral
 * fallback first and the live value after mount — no hydration mismatch, never stale.
 */
export function useNow(refreshMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);
  return now;
}
