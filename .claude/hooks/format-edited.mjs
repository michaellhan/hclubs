#!/usr/bin/env node
// PostToolUse hook for Edit/Write: cheap per-file hygiene, never the test suite.
// 1. Prettier --write, but only on files that were already Prettier-clean at HEAD (or are new),
//    so editing a legacy-formatted file doesn't drown the diff in reformatting.
// 2. ESLint on that one file; problems are reported back to Claude as context (non-blocking).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { projectDir, readInput } from "./lib.mjs";

const PRETTIER_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".md"]);
const ESLINT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const bin = (name) => path.join(projectDir, "node_modules/.bin", name);
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: projectDir, timeout: 20_000, stdio: ["pipe", "pipe", "pipe"], ...opts });

try {
  const input = await readInput();
  const file = input.tool_input?.file_path;
  if (!file || !existsSync(file)) process.exit(0);
  const rel = path.relative(projectDir, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) process.exit(0); // outside the repo
  const ext = path.extname(file);

  if (PRETTIER_EXT.has(ext) && existsSync(bin("prettier"))) {
    let cleanAtHead = true;
    try {
      const old = run("git", ["show", `HEAD:${rel}`]);
      try {
        run(bin("prettier"), ["--check", "--stdin-filepath", rel], { input: old });
      } catch {
        cleanAtHead = false;
      }
    } catch {
      // Not in HEAD (new file): format it.
    }
    if (cleanAtHead) {
      try {
        // Respects .prettierignore (CLAUDE.md, migrations, fixtures are ignored).
        run(bin("prettier"), ["--write", "--log-level=silent", rel]);
      } catch {
        // Syntax errors surface via ESLint/typecheck instead.
      }
    }
  }

  if (ESLINT_EXT.has(ext) && existsSync(bin("eslint"))) {
    try {
      run(bin("eslint"), ["--no-warn-ignored", rel]);
    } catch (error) {
      const out = String(error.stdout ?? "")
        .trim()
        .split("\n")
        .slice(0, 20)
        .join("\n");
      if (out)
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: `ESLint problems in ${rel}:\n${out}`,
            },
          }),
        );
    }
  }
} catch {
  // Never interfere with the edit.
}
process.exit(0);
