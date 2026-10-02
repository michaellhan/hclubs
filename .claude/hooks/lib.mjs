// Shared helpers for the autonomous-session hooks (see .claude/hooks/README.md).
// Pure parsing lives here so test-hooks.sh can exercise it deterministically.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
export const backlogPath = path.join(projectDir, ".claude/autonomous-backlog.md");
export const togglePath = path.join(projectDir, ".claude/autonomous.on");
const stateDir = path.join(projectDir, ".claude/state");

/** Own safety cap on continuations per session, below Claude Code's CLAUDE_CODE_STOP_HOOK_BLOCK_CAP. */
export const MAX_CONTINUATIONS = 25;

export async function readInput() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

/** Autonomous mode is opt-in: `.claude/autonomous.on` exists and HCLUBS_AUTONOMOUS isn't 0/off. */
export function autonomousEnabled() {
  const env = (process.env.HCLUBS_AUTONOMOUS ?? "").toLowerCase();
  if (["0", "off", "false", "no"].includes(env)) return false;
  return existsSync(togglePath);
}

// ---------- backlog ----------

const ACTIONABLE_SECTIONS = ["ACTIVE", "IN REVIEW", "READY"]; // also the tie-break order
const ITEM = /^\s*[-*]\s+(?:\[([ xX])\]\s+)?\[(P[0-3])\]\s*(.+)$/;

/** Items in ACTIVE / IN REVIEW / READY with priority P0–P2, best first. Everything else is ignored. */
export function actionableItems(markdown) {
  const items = [];
  let section = null;
  markdown.split("\n").forEach((line, index) => {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const name = heading[1].toUpperCase();
      section = ACTIONABLE_SECTIONS.find((s) => name === s || name.startsWith(`${s} `)) ?? null;
      return;
    }
    if (!section) return;
    const m = ITEM.exec(line);
    if (!m || (m[1] && m[1] !== " ")) return; // not an item, or ticked off
    const priority = Number(m[2].slice(1));
    if (priority > 2) return; // P3 never keeps a session alive
    items.push({ priority, section, index, text: m[3].trim() });
  });
  const order = (s) => ACTIONABLE_SECTIONS.indexOf(s);
  return items.sort((a, b) => a.priority - b.priority || order(a.section) - order(b.section) || a.index - b.index);
}

// ---------- check commands (typecheck / lint / test / build) ----------

const KIND_WORDS = {
  typecheck: "typecheck",
  tsc: "typecheck",
  lint: "lint",
  eslint: "lint",
  test: "test",
  vitest: "test",
  build: "build",
};
const ALL_KINDS = ["typecheck", "lint", "test", "build"];

/**
 * Which project checks a shell command runs. Only package-manager script names and the check
 * tools themselves count; `pnpm hci …` (pipeline CLI, e.g. `audit --check=…`) never does.
 * Returns { kinds, full }: `full` means the unscoped repo-wide run that proves the kind green.
 */
export function classifyCommand(command) {
  const cmd = String(command ?? "")
    .trim()
    .replace(/^(?:cd\s+\S+\s*&&\s*)+/, "");
  if (/[|;]|&&/.test(cmd)) return { kinds: [], full: false }; // pipelines/chains: exit status isn't the check's
  const tokens = cmd.split(/\s+/);
  const runner = tokens[0];
  if (!["pnpm", "npm", "npx", "yarn", "vitest", "tsc", "eslint"].includes(runner)) return { kinds: [], full: false };
  if (tokens.includes("hci")) return { kinds: [], full: false };
  const words = tokens.filter((t) => !t.startsWith("-") && !t.startsWith("@"));
  const kinds = new Set();
  for (const w of words) {
    if (w === "check") ALL_KINDS.forEach((k) => kinds.add(k));
    else if (KIND_WORDS[w]) kinds.add(KIND_WORDS[w]);
  }
  const full = [
    "pnpm typecheck",
    "pnpm lint",
    "pnpm test",
    "pnpm build",
    "pnpm check",
    "pnpm --filter @hci/web build",
  ].includes(tokens.join(" "));
  return { kinds: [...kinds], full };
}

// ---------- per-session state ----------

function statePath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(stateDir, `${safe}.json`);
}

export function loadState(sessionId) {
  try {
    return {
      failing: {},
      continuations: 0,
      fingerprint: null,
      ...JSON.parse(readFileSync(statePath(sessionId), "utf8")),
    };
  } catch {
    return { failing: {}, continuations: 0, fingerprint: null };
  }
}

export function saveState(sessionId, state) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath(sessionId), JSON.stringify(state, null, 2));
}

/** Changes whenever the backlog, HEAD, or the working tree changes — "did anything happen?". */
export function progressFingerprint() {
  const hash = createHash("sha256");
  try {
    hash.update(readFileSync(backlogPath));
  } catch {
    hash.update("no-backlog");
  }
  for (const args of [
    ["rev-parse", "HEAD"],
    ["status", "--porcelain"],
    ["diff", "HEAD"],
  ]) {
    try {
      hash.update(execFileSync("git", args, { cwd: projectDir, timeout: 10_000, maxBuffer: 64 << 20 }));
    } catch {
      hash.update(`git ${args[0]} failed`);
    }
  }
  return hash.digest("hex");
}
