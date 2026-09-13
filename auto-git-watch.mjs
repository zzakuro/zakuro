#!/usr/bin/env node
// Auto-commit + push watcher for the Zakuro Archive repo (code only).
//
// Watches the fitlib project directory (ignoring data/, dist/, node_modules/,
// logs, dumps) and commits+pushes any code change after a debounce. Skips
// pushing if one happened moments ago to avoid hammering GitHub.
//
// Run from anywhere:
//   node auto-git-watch.mjs              (manual foreground)
// Logs to stdout; expected to run as the "ZakuroAutoGit" scheduled task.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.ZAKURO_REPO_ROOT || here;
const watchDir =
  process.env.ZAKURO_WATCH_DIR ||
  path.join(repoRoot, "zakuros-archive-main (4)", "zakuros-archive-main", "fitlib");

const DEBOUNCE_MS = Number(process.env.ZAKURO_DEBOUNCE_MS || 15000);
const POLL_MS = Number(process.env.ZAKURO_POLL_MS || 90000); // safety re-check
const PUSH_COOLDOWN_MS = Number(process.env.ZAKURO_PUSH_COOLDOWN_MS || 120000);

const IGNORED_SEGMENTS = new Set(["data", "dist", "node_modules", "__pycache__", ".git"]);

function isIgnored(rel) {
  const segs = rel.split(path.sep);
  if (segs.some((s) => IGNORED_SEGMENTS.has(s))) return true;
  if (/\.log$/i.test(rel)) return true;
  if (/(^|\/)(merged\.json|merged_enriched\.json|metadata\.json)$/.test(rel)) return true;
  return false;
}

function git(args) {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: String(e?.stdout || e?.stderr || e?.message || "") };
  }
}

let debounceTimer = null;
let inFlight = false;
let lastPush = 0;

function schedule() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(commitAndPush, DEBOUNCE_MS);
}

function commitAndPush() {
  if (inFlight) return;
  debounceTimer = null;

  git(["add", "-A"]);
  const status = git(["status", "--porcelain"]);
  if (!status.ok || !status.out.trim()) {
    console.log(`[auto-git] ${new Date().toLocaleTimeString()} nothing to commit`);
    return;
  }

  const changed = status.out.trim().split("\n");
  actuallyCommit(changed);
}

function actuallyCommit(changed) {
  inFlight = true;
  try {
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const summary = changed.slice(0, 15).join("\n") + (changed.length > 15 ? `\n... (+${changed.length - 15} more)` : "");
    const msg = `auto: code update ${stamp}\n\n${summary}`;
    const commit = git(["commit", "-m", msg]);
    if (!commit.ok) {
      console.log("[auto-git] commit failed:", commit.out.trim().split("\n").slice(-3).join(" "));
      return; // e.g. no identity configured; will retry on next change
    }
    console.log(`[auto-git] committed ${changed.length} path(s)`);

    if (Date.now() - lastPush < PUSH_COOLDOWN_MS) {
      console.log("[auto-git] push skipped (recent push)");
      return;
    }
    let push = git(["push"]);
    if (!push.ok) {
      // Maybe remote moved ahead: rebase once and retry.
      git(["pull", "--rebase"]);
      push = git(["push"]);
    }
    lastPush = Date.now();
    console.log(push.ok ? "[auto-git] pushed" : "[auto-git] push failed:\n" + push.out.trim().split("\n").slice(-4).join("\n"));
  } finally {
    inFlight = false;
  }
}

console.log(`[auto-git] watching ${watchDir}`);
console.log(`[auto-git] repo ${repoRoot} | push cooldown ${Math.round(PUSH_COOLDOWN_MS / 1000)}s`);

let watcher;
try {
  watcher = fs.watch(watchDir, { recursive: true }, (_event, filename) => {
    if (!filename || isIgnored(String(filename))) return;
    schedule();
  });
  console.log("[auto-git] fs.watch active");
} catch (e) {
  console.warn("[auto-git] fs.watch failed, falling back to polling only:", e.message);
}

setInterval(() => {
  // Mirror of the debounced commit; catches events watchers miss.
  if (!inFlight && !debounceTimer) schedule();
}, POLL_MS);

process.on("SIGINT", () => {
  watcher?.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  watcher?.close();
  process.exit(0);
});