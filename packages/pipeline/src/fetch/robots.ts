/**
 * Minimal robots.txt implementation (RFC 9309): user-agent groups, Allow/Disallow with
 * `*` and `$` wildcards, longest-match precedence (Allow wins ties), Crawl-delay.
 */
export interface RobotsRules {
  allows(path: string): boolean;
  crawlDelaySeconds: number | null;
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const product = userAgent.split("/")[0]?.toLowerCase().trim() ?? "*";
  const groups: { agents: string[]; rules: Rule[]; delay: number | null }[] = [];
  let current: { agents: string[]; rules: Rule[]; delay: number | null } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (value === "" && key === "disallow") continue; // empty Disallow = allow all
      current.rules.push({ allow: key === "allow", pattern: value, regex: toRegex(value) });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.delay = n;
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && product.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = chosen.map((g) => g.delay).find((d) => d !== null) ?? null;

  return {
    crawlDelaySeconds: delay,
    allows(path: string) {
      let best: Rule | null = null;
      for (const r of rules) {
        if (!r.regex.test(path)) continue;
        if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) {
          best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}
