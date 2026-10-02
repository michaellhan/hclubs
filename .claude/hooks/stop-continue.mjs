#!/usr/bin/env node
// Stop hook: in autonomous mode, keep the lead session working while the backlog has
// actionable P0–P2 items or a check it ran this session is still failing.
// Every path that isn't a deliberate "block" allows stopping (exit 0, no output).
import { existsSync, readFileSync } from "node:fs";
import {
  MAX_CONTINUATIONS,
  actionableItems,
  autonomousEnabled,
  backlogPath,
  loadState,
  progressFingerprint,
  readInput,
  saveState,
} from "./lib.mjs";

const allow = (note) => {
  if (note) process.stdout.write(JSON.stringify({ systemMessage: `Autonomous hook: ${note}` }));
  process.exit(0);
};

try {
  const input = await readInput();
  if (!autonomousEnabled()) allow();
  // Only the lead session is driven; subagents/teammates finish normally.
  if (input.agent_id || input.agent_type) allow();
  if (!existsSync(backlogPath)) allow();

  const sessionId = input.session_id;
  const state = loadState(sessionId);
  const items = actionableItems(readFileSync(backlogPath, "utf8"));
  const failing = Object.entries(state.failing ?? {});

  if (items.length === 0 && failing.length === 0) {
    saveState(sessionId, { ...state, continuations: 0, fingerprint: null });
    allow();
  }

  // Recursion guard. stop_hook_active means this stop follows one of our own continuations:
  // only continue again if something actually changed since then, and never past the cap.
  const fingerprint = progressFingerprint();
  if (input.stop_hook_active) {
    if (state.fingerprint === fingerprint)
      allow("no change to the backlog or working tree since the last continuation — letting the session stop.");
    if (state.continuations >= MAX_CONTINUATIONS)
      allow(`reached ${MAX_CONTINUATIONS} continuations this session — letting the session stop.`);
  } else {
    state.continuations = 0; // a fresh user turn starts a new run
  }

  saveState(sessionId, { ...state, continuations: state.continuations + 1, fingerprint });

  const lines = ["Autonomous mode (CLAUDE.md §26) — not done yet."];
  if (failing.length) {
    lines.push("Checks that failed this session and haven't passed since (fix these first, they count as P0):");
    for (const [cmd, f] of failing) lines.push(`  - \`${cmd}\` (${f.kinds.join(", ")})`);
  }
  if (items.length) {
    const top = items[0];
    lines.push(
      `${items.length} actionable P0–P2 backlog item(s). Next: [P${top.priority}] ${top.text} (${top.section}).`,
    );
  }
  lines.push(
    "Continue with the highest-value unblocked task and keep .claude/autonomous-backlog.md current. " +
      "If an item truly needs the owner, move it to BLOCKED / HUMAN REVIEW with the reason. " +
      "To end autonomous mode: rm .claude/autonomous.on",
  );
  process.stdout.write(JSON.stringify({ decision: "block", reason: lines.join("\n") }));
  process.exit(0);
} catch (error) {
  allow(`hook error, allowing stop (${error instanceof Error ? error.message : String(error)}).`);
}
