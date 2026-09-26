import fs from "fs";
import path from "path";
import express from "express";
import type { Response } from "express";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

// ── Scraper API router ────────────────────────────────────────────────────────
// HTTP front-end over the config-driven scraper engine (scraper_api.py).
// Site definitions live in data/scraper-sites.json; cached payloads in
// data/scraped/<key>.json. Endpoints:
//   GET    /api/scraper/sites          list configured sites
//   POST   /api/scraper/sites          create/update a site (upsert by key)
//   DELETE /api/scraper/sites/:key     remove a site + cached result
//   POST   /api/scraper/run/:key       run the engine for a site (buffered)
//   GET    /api/scraper/results/:key   last cached payload for a site
//   GET    /api/scraper/live?url=&name= best-effort single-page scrape
//   POST   /api/scraper/live-run/:key  run the engine, streaming progress live
//   GET    /api/scraper/live-runs      current + recent live run records
//   GET    /api/scraper/live-stream/:key  SSE feed (events: hello/line/start/done)

const execFileP = promisify(execFile);

const SITES_PATH = path.join(process.cwd(), "data", "scraper-sites.json");
const SCRAPED_DIR = path.join(process.cwd(), "data", "scraped");
const ENGINE_SCRIPT = path.join(process.cwd(), "scraper_api.py");
const SCRAPLING_PY =
  process.env.SCRAPLING_PY ||
  "C:\\Users\\Mfree\\AppData\\Local\\Temp\\opencode\\scr-venv\\Scripts\\python.exe";

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/i;

// ── Live run tracking + SSE fan-out ───────────────────────────────────────────
// Engine (scraper_api.py) prints "PROGRESS\t{json}" lines to stdout; we capture
// them per line, keep a rolling log, and push them to browser SSE subscribers so
// the live-scraping panel shows progress in real time.
interface ScraperRunRecord {
  key: string;
  name: string;
  startedAt: number;
  finishedAt?: number;
  running: boolean;
  total: number | null;
  done: number;
  lastTitle: string | null;
  lastLinks: number | null;
  lastEvent: string | null;
  code: number | null;
  error?: string;
  lines: { ts: number; text: string }[];
}

const liveRuns = new Map<string, ScraperRunRecord>();
const liveSubs = new Map<string, Set<Response>>();
const LIVE_LINE_CAP = 3000;

function sseSend(res: Response, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(key: string, payload: unknown): void {
  const subs = liveSubs.get(key);
  if (subs) for (const s of subs) {
    try { sseSend(s, payload); } catch { /* client gone */ }
  }
}

function liveRecordShape(r: ScraperRunRecord) {
  return {
    key: r.key,
    name: r.name,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    running: r.running,
    total: r.total,
    done: r.done,
    lastTitle: r.lastTitle,
    lastLinks: r.lastLinks,
    lastEvent: r.lastEvent,
    code: r.code,
    error: r.error,
    tail: r.lines.slice(-10).map((l) => l.text),
  };
}

function startLiveRun(key: string, maxPosts: number): ScraperRunRecord | null {
  const existing = liveRuns.get(key);
  if (existing?.running) return existing;
  const sites = loadSites();
  const site = sites[key];
  if (!site) return null;

  const rec: ScraperRunRecord = {
    key,
    name: String(site.name ?? key),
    startedAt: Date.now(),
    running: true,
    total: null,
    done: 0,
    lastTitle: null,
    lastLinks: null,
    lastEvent: null,
    code: null,
    lines: [],
  };
  liveRuns.set(key, rec);
  broadcast(key, { type: "start", key, name: rec.name });

  const args = [ENGINE_SCRIPT, key];
  if (maxPosts > 0) args.push("--max-posts", String(Math.floor(maxPosts)));
  const child = spawn(SCRAPLING_PY, args, { cwd: process.cwd(), windowsHide: true });

  const sink = (chunk: Buffer | string) => {
    const text = chunk.toString();
    const ts = Date.now();
    const line = text.replace(/\r?\n/g, " ").trim().slice(0, 2000);
    if (!line) return;
    rec.lines.push({ ts, text: line });
    if (rec.lines.length > LIVE_LINE_CAP) rec.lines.splice(0, rec.lines.length - LIVE_LINE_CAP);
    broadcast(key, { type: "line", ts, text: line });
  };

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: Buffer | string) => {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      const ts = Date.now();
      rec.lines.push({ ts, text: line });
      if (rec.lines.length > LIVE_LINE_CAP) rec.lines.splice(0, rec.lines.length - LIVE_LINE_CAP);
      if (line.startsWith("PROGRESS\t")) {
        try {
          const evt = JSON.parse(line.slice("PROGRESS\t".length)) as any;
          if (evt.event === "listing") rec.total = Number(evt.posts) || null;
          else if (evt.event === "post") {
            rec.done += 1;
            rec.lastTitle = evt.title ?? null;
            rec.lastLinks = Number(evt.links) ?? null;
          } else if (evt.event === "done") rec.total = Number(evt.total) ?? rec.total;
          rec.lastEvent = evt.event ?? null;
        } catch { /* not parseable → still show the raw line */ }
      }
      broadcast(key, { type: "line", ts, text: line });
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", sink);

  child.on("close", (code) => {
    rec.running = false;
    rec.finishedAt = Date.now();
    rec.code = code;
    broadcast(key, {
      type: "done",
      ok: code === 0,
      code,
      ms: rec.finishedAt - rec.startedAt,
      total: rec.total,
      done: rec.done,
    });
  });
  child.on("error", (e: Error) => {
    rec.running = false;
    rec.finishedAt = Date.now();
    rec.error = e.message;
    broadcast(key, { type: "done", ok: false, code: null, ms: Date.now() - rec.startedAt, total: rec.total, done: rec.done, error: e.message });
  });

  // Prune records older than 10 min for keys that aren't running.
  const deadline = Date.now() - 10 * 60 * 1000;
  for (const [k, r] of liveRuns) if (!r.running && (r.finishedAt ?? 0) < deadline) liveRuns.delete(k);
  return rec;
}

const SITE_FIELDS = [
  "name",
  "home",
  "mode",
  "pages",
  "maxPosts",
  "postLinkPattern",
  "entryPattern",
  "pageLinkPattern",
  "linkPattern",
  "resolver",
  "titleStrip",
  "sizePattern",
  "partPattern",
  "partLabelPattern",
  "skipLinkPatterns",
  "linkSkipPatterns",
  "linkSectionFrom",
  "linkSectionTo",
  "stripListNumbers",
  "linkSource",
  "linkAliases",
  "titleSource",
] as const;

function loadSites(): Record<string, Record<string, unknown>> {
  if (!fs.existsSync(SITES_PATH)) return {};
  return JSON.parse(fs.readFileSync(SITES_PATH, "utf-8"));
}

function saveSites(sites: Record<string, Record<string, unknown>>): void {
  fs.mkdirSync(path.dirname(SITES_PATH), { recursive: true });
  fs.writeFileSync(SITES_PATH, JSON.stringify(sites, null, 2));
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function runEngine(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP(SCRAPLING_PY, ["-X", "utf8", ...args], {
    cwd: process.cwd(),
    timeout: 6 * 60 * 1000,
    maxBuffer: 5 * 1024 * 1024,
  });
}

function readPayload(key: string): unknown {
  const p = path.join(SCRAPED_DIR, `${key}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export function scraperRouter(): express.Router {
  const router = express.Router();

  router.get("/sites", (_req, res) => {
    const sites = loadSites();
    res.json({ engine: "scrapling", count: Object.keys(sites).length, sites });
  });

  router.post("/sites", (req, res) => {
    const body = req.body ?? {};
    const key = String(body.key ?? "").trim().toLowerCase() || slugify(String(body.name ?? ""));
    if (!KEY_RE.test(key)) {
      return res.status(400).json({ error: "invalid key (use a-z 0-9 _ -)" });
    }
    const home = String(body.home ?? "").trim();
    if (!/^https?:\/\//.test(home)) {
      return res.status(400).json({ error: "'home' must be a valid http(s) URL" });
    }
    const site: Record<string, unknown> = { name: String(body.name ?? key), home };
    const arrayFields = ["skipLinkPatterns"] as const;
    const boolFields = ["stripListNumbers"] as const;
    const objectFields = ["linkAliases"] as const;
    for (const f of SITE_FIELDS) {
      if (f === "name" || f === "home") continue;
      const v = body[f];
      if (typeof v === "string" && v.length) site[f] = v;
      if (typeof v === "number") site[f] = v;
      if (arrayFields.includes(f as (typeof arrayFields)[number]) && Array.isArray(v) && (v as unknown[]).every((x) => typeof x === "string")) {
        site[f] = v;
      }
      if (boolFields.includes(f as (typeof boolFields)[number]) && typeof v === "boolean") {
        site[f] = v;
      }
      if (objectFields.includes(f as (typeof objectFields)[number]) && v && typeof v === "object" && !Array.isArray(v)) {
        site[f] = v as Record<string, string>;
      }
    }
    const sites = loadSites();
    const existed = key in sites;
    sites[key] = site;
    saveSites(sites);
    res.json({ ok: true, created: !existed, key, site });
  });

  router.delete("/sites/:key", (req, res) => {
    const key = String(req.params.key).toLowerCase();
    const sites = loadSites();
    if (!(key in sites)) return res.status(404).json({ error: `no site '${key}'` });
    delete sites[key];
    saveSites(sites);
    const cached = path.join(SCRAPED_DIR, `${key}.json`);
    if (fs.existsSync(cached)) fs.rmSync(cached);
    res.json({ ok: true, key });
  });

  router.post("/run/:key", async (req, res) => {
    const key = String(req.params.key).toLowerCase();
    const sites = loadSites();
    if (!(key in sites)) return res.status(404).json({ error: `no site '${key}'` });
    const maxPosts = Number(req.query.maxPosts ?? req.body?.maxPosts ?? 0);
    const args = [ENGINE_SCRIPT, key];
    if (maxPosts > 0) args.push("--max-posts", String(Math.floor(maxPosts)));
    const started = Date.now();
    try {
      await runEngine(args);
      const payload = readPayload(key);
      if (!payload) throw new Error("engine produced no output file");
      const entries = Array.isArray((payload as { downloads?: unknown[] }).downloads)
        ? (payload as { downloads: unknown[] }).downloads.length
        : 0;
      res.json({ ok: true, key, ms: Date.now() - started, entries, payload });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, key, ms: Date.now() - started, error: err });
    }
  });

  router.get("/results/:key", (req, res) => {
    const key = String(req.params.key).toLowerCase();
    const payload = readPayload(key);
    if (!payload) return res.status(404).json({ error: `no cached result for '${key}'` });
    res.json(payload);
  });

  router.get("/live", async (req, res) => {
    const url = String(req.query.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: "?url= is required (http(s))" });
    const name = String(req.query.name ?? "live").trim().slice(0, 80);
    const started = Date.now();
    try {
      await runEngine([ENGINE_SCRIPT, "--url", url, "--name", name || "live"]);
      const payload = readPayload("_live");
      if (!payload) throw new Error("engine produced no output");
      res.json({ ok: true, ms: Date.now() - started, payload });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      res.status(500).json({ ok: false, error: err });
    }
  });

  // Kick off a site run that streams progress live (used by the secret-sources
  // live panel). Returns 409 if the site is already mid-run.
  router.post("/live-run/:key", (req, res) => {
    const key = String(req.params.key).toLowerCase();
    const existing = liveRuns.get(key);
    if (existing?.running) {
      return res.status(409).json({ error: `'${key}' is already running`, record: liveRecordShape(existing) });
    }
    const rec = startLiveRun(key, Number(req.query.maxPosts ?? 0));
    if (!rec) return res.status(404).json({ error: `no site '${key}'` });
    res.json({ ok: true, record: liveRecordShape(rec) });
  });

  router.get("/live-runs", (_req, res) => {
    const runs = [...liveRuns.values()].sort((a, b) => b.startedAt - a.startedAt).map(liveRecordShape);
    res.json({ count: runs.length, runs });
  });

  // SSE feed for one site key. Replays buffered lines since `since` (ms), then
  // streams start/line/done events. Kept open until the client disconnects.
  router.get("/live-stream/:key", (req, res) => {
    const key = String(req.params.key).toLowerCase();
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    const since = Number(req.query.since ?? 0) || 0;
    const rec = liveRuns.get(key);
    sseSend(res, rec
      ? {
          type: "hello",
          key,
          running: rec.running,
          total: rec.total,
          done: rec.done,
          startedAt: rec.startedAt,
          finishedAt: rec.finishedAt,
          lastTitle: rec.lastTitle,
          lastLinks: rec.lastLinks,
        }
      : { type: "hello", key, running: false, total: null, done: null, startedAt: null, finishedAt: null });
    if (rec) {
      for (const l of rec.lines.filter((l) => l.ts > since).slice(-1500)) {
        sseSend(res, { type: "line", ts: l.ts, text: l.text });
      }
    }

    let subs = liveSubs.get(key);
    if (!subs) {
      subs = new Set();
      liveSubs.set(key, subs);
    }
    subs.add(res);
    const heartbeat = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* closed */ }
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      subs!.delete(res);
      if (subs!.size === 0) liveSubs.delete(key);
    });
  });

  return router;
}