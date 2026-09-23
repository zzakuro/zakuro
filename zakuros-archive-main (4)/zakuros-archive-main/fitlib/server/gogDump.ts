import fs from "fs";
import path from "path";

export interface GogDumpRec {
  gogId: string;
  slug: string;
  title: string;
  developer: string;
  publisher: string;
  gogUrl: string;
  image: string; // 60-hex GOG CDN asset hash ('' when NULL)
  releaseDate: string; // YYYY-MM-DD
  rating?: number;
  genres?: string[];
}

// Repo-root dump (fitlib/server -> fitlib -> zakuro) or overrides.
export function resolveDumpPath(): string {
  const candidates = [
    process.env.GOG_DUMP || "",
    path.join(process.cwd(), "..", "..", "..", "gog-games.to-database.sql"),
    path.join(process.cwd(), "..", "..", "gog-games.to-database.sql"),
    path.join(process.cwd(), "..", "gog-games.to-database.sql"),
    path.join(process.cwd(), "gog-games.to-database.sql"),
  ].filter(Boolean);
  return candidates.find((c) => {
    try {
      return fs.statSync(c).size > 0;
    } catch {
      return false;
    }
  }) || "";
}

// Parse the games table rows of a MariaDB dump. Row shape (id is a quoted
// varchar, hence the opening '(''):  ('<id>','<slug>','<title>','<dev>','<pub>',
// <views…>, '<genres JSON>', '<tags JSON>', <rating>,<age>,'<release_dt>',
// '<image60>','<background60>','https://www.gog.com/game/<slug>', <md5>…).
export function parseGogDump(file: string): Map<string, GogDumpRec> {
  const out = new Map<string, GogDumpRec>();
  if (!file) return out;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  const rowRe = /^\('(\d+)','((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)'/;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("(")) continue;
    const m = t.match(rowRe);
    if (!m) continue;
    const tail = t.slice(m[0].length);

    const rec: GogDumpRec = {
      gogId: m[1],
      slug: m[2].replace(/\\'/g, "'"),
      title: m[3].replace(/\\'/g, "'"),
      developer: m[4].replace(/\\'/g, "'"),
      publisher: m[5].replace(/\\'/g, "'"),
      gogUrl: "",
      image: "",
      releaseDate: "",
    };

    const date = tail.match(/,[01],'(\d{4}-\d{2}-\d{2})/);
    if (date) rec.releaseDate = date[1];
    const rating = tail.match(/,([0-9]+(?:\.[0-9])?),[01],'\d{4}/);
    if (rating) rec.rating = Number(rating[1]);
    const gogUrl = tail.match(/'((?:https?:)?\/\/www\.gog\.com\/game\/[a-z0-9_-]+)'/);
    if (gogUrl) rec.gogUrl = gogUrl[1];
    // First two 60-hex quoted tokens are the image and background asset hashes.
    const hex = tail.match(/'([0-9a-f]{60})'/g) ?? [];
    const hexFirst = hex[0];
    if (hex.length > 0 && hexFirst) rec.image = hexFirst.slice(1, -1);
    const hexSecond = hex[1];
    if (hex.length > 1 && !rec.image && hexSecond) rec.image = hexSecond.slice(1, -1);
    // genres/tags are the only quoted tokens that start with '['.
    const jsonArr = tail.match(/'\[((?:\\.|[^'\\])*)\]'/g) ?? [];
    const rawGenres = jsonArr.length > 0 && jsonArr[0] ? jsonArr[0].slice(1, -1) : "";
    if (rawGenres) {
      try {
        rec.genres = JSON.parse(rawGenres.replace(/\\(["\\])/g, "$1"));
      } catch {
        rec.genres = rawGenres.split(",").map((s) => s.replace(/\\"/g, "").trim()).filter(Boolean);
      }
    }

    if (!out.has(rec.gogId)) out.set(rec.gogId, rec);
  }
  return out;
}