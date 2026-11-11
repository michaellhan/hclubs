"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect } from "react";
import { track } from "@/lib/track";

declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string; event?: boolean }) => void; no_onload?: boolean };
    posthog?: { capture?: (event: string, props?: Record<string, unknown>) => void };
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

// PostHog's loader (loads its script from PostHog's CDN, so nothing is added to the app's JS bundle).
const POSTHOG_LOADER = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog&&window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister identify reset alias set_config get_distinct_id get_property setPersonProperties opt_in_capturing opt_out_capturing has_opted_out_capturing onFeatureFlags isFeatureEnabled getFeatureFlag".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;

/**
 * PostHog: anonymous visitors (a first-party cookie, so returning visitors and retention can be
 * counted), page views on every navigation, and the track.ts events. No autocapture, session
 * recording or surveys, and the search box's text (?q=) is stripped from every URL it sends.
 */
function PostHog({ apiKey }: { apiKey: string }) {
  // Only the first run may load PostHog. The <Script> id must not be "posthog": an element with that id would
  // show up as window.posthog (named access) and the loader would mistake it for PostHog.
  const init = `if (!window.__hclubsPostHog) {
window.__hclubsPostHog = true;
${POSTHOG_LOADER}
(function () {
  function scrub(v) {
    if (!/^(https?:\\/\\/|\\/)/.test(v)) return v; // "$direct" and the like
    try {
      var u = new URL(v, location.origin);
      if (u.origin !== location.origin) return v;
      u.searchParams.delete("q"); u.hash = "";
      return /^https?:/.test(v) ? u.href : u.pathname + u.search;
    } catch (e) { return v; }
  }
  function clean(o) { if (o) for (var k in o) if (typeof o[k] === "string" && /url|pathname|referrer/i.test(k)) o[k] = scrub(o[k]); }
  posthog.init(${JSON.stringify(apiKey)}, {
    api_host: "https://us.i.posthog.com", defaults: "2026-08-30", person_profiles: "always",
    autocapture: false, capture_heatmaps: false, capture_dead_clicks: false, disable_session_recording: true, disable_surveys: true, respect_dnt: true,
    before_send: function (e) { clean(e.properties); clean(e.$set); clean(e.$set_once); return e; }
  });
  posthog.register({ site: "hclubs" });
})();
}`;
  return <Script id="posthog-init" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: init }} />;
}

/** GoatCounter's script plus the counter, and PostHog; each renders nothing when it isn't configured. */
export function Analytics({ endpoint, posthogKey }: { endpoint: string | null; posthogKey?: string | null }) {
  return (
    <>
      {endpoint ? (
        <>
          <script
            async
            src="https://gc.zgo.at/count.js"
            data-goatcounter={endpoint}
            data-goatcounter-settings='{"no_onload": true}'
          />
          <PageViews />
        </>
      ) : null}
      {posthogKey ? <PostHog apiKey={posthogKey} /> : null}
      {endpoint || posthogKey ? <ClickEvents /> : null}
    </>
  );
}
