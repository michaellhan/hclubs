#!/usr/bin/env node
// PostToolUse / PostToolUseFailure hook for Bash: remember project checks (typecheck, lint,
// test, build) that failed this session until they pass again. The Stop hook reads this.
import { classifyCommand, loadState, readInput, saveState } from "./lib.mjs";

try {
  const input = await readInput();
  const command = String(input.tool_input?.command ?? "").trim();
  const { kinds, full } = classifyCommand(command);
  if (kinds.length === 0) process.exit(0);

  const failed = input.hook_event_name === "PostToolUseFailure" && !input.is_interrupt;
  const interrupted = input.hook_event_name === "PostToolUseFailure" && input.is_interrupt;
  if (interrupted) process.exit(0);

  const state = loadState(input.session_id);
  const failing = { ...(state.failing ?? {}) };
  if (failed) {
    failing[command] = { kinds, at: new Date().toISOString() };
  } else {
    delete failing[command];
    // A clean unscoped run (e.g. `pnpm test`) clears every earlier failure of that kind.
    if (full)
      for (const [cmd, f] of Object.entries(failing)) if (f.kinds.every((k) => kinds.includes(k))) delete failing[cmd];
  }
  saveState(input.session_id, { ...state, failing });
} catch {
  // Never interfere with the tool call.
}
process.exit(0);
