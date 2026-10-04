"use client";

import { useEffect } from "react";

/**
 * Opens a collapsed profile row when a link points at it (e.g. /clubs/x/#how-to-join from
 * Saved): browsers scroll to a closed <details> but don't open it.
 */
export function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      const details = el?.closest("details");
      if (details && !details.open) {
        details.open = true;
        el?.scrollIntoView();
      }
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
