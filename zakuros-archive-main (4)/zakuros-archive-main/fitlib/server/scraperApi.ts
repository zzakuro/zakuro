import fs from "fs";
import path from "path";
import express from "express";
import { execFile } from "child_process";
import { promisify } from "util";

// ── Scraper API router ────────────────────────────────────────────────────────
// HTTP front-end over the config-driven scraper engine (scraper_api.py).
// Site definitions live in data/scraper-sites.json; cached payloads in
// data/scraped/<key>.json. Endpoints:
//   GET    /api/scraper/sites          list configured sites
//   POST   /api/scraper/sites          create/update a site (upsert by key)
//   DELETE /api/scraper/sites/:key     remove a site + cached result
//   POST   /api/scraper/run/:key       run the engine for a site
//   GET    /api/scraper/results/:key   last cached payload for a site
//   GET    /api/scraper/live?url=&name= best-effort single-page scrape

const execFileP = promisify(execFile);

const SITES_PATH = path.join(process.cwd(), "data", "scraper-sites.json");
const SCRAPED_DIR = path.join(process.cwd(), "data", "scraped");
const ENGINE_SCRIPT = path.join(process.cwd(), "scraper_api.py");
const SCRAPLING_PY =
  process.env.SCRAPLING_PY ||
  "C:\\Users\\Mfree\\AppData\\Local\\Temp\\opencode\\scr-venv\\Scripts\\python.exe";

const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/i;

const SITE_FIELDS = [
  "name",
  "home",
  "pages",
  "maxPosts",
  "postLinkPattern",
  "linkPattern",
  "resolver",
  "titleStrip",
  "partPattern",
  "partLabelPattern",
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
  return execFileP(SCRAPLING_PY, args, {
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
    for (const f of SITE_FIELDS) {
      if (f === "name" || f === "home") continue;
      const v = body[f];
      if (typeof v === "string" && v.length) site[f] = v;
      if (typeof v === "number") site[f] = v;
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

  return router;
}