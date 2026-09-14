// Catalog on-disk IO. The enriched catalog is ~80MB+ of JSON — too large to
// push to the small-file limits of some remotes — so it lives on disk as
// gzip and is (de)compressed transparently here. Reads fall back to a legacy
// plain .json file if one still exists; writes always produce gzip.
import fs from "fs";
import path from "path";
import { gzipSync, gunzipSync } from "zlib";

const GZ_PATH = path.join(process.cwd(), "data", "merged_enriched.json.gz");
const JSON_PATH = path.join(process.cwd(), "data", "merged_enriched.json");

export const GAMES_DB_PATH = GZ_PATH;

export function readGames<T>(): T[] {
  const parseBuffer = (buf: Buffer | string): T[] => JSON.parse(buf.toString("utf8")) as T[];
  try {
    if (fs.existsSync(GZ_PATH)) return parseBuffer(gunzipSync(fs.readFileSync(GZ_PATH)));
    if (fs.existsSync(JSON_PATH)) return parseBuffer(fs.readFileSync(JSON_PATH));
  } catch (gzErr: any) {
    console.error(`[CatalogIO] Corrupt catalog: ${gzErr.message}`);
    if (fs.existsSync(JSON_PATH)) {
      try {
        return parseBuffer(fs.readFileSync(JSON_PATH));
      } catch (legacyErr: any) {
        console.error("[CatalogIO] Legacy JSON fallback also corrupt:", legacyErr.message);
      }
    }
    throw new Error(`Catalog at ${GZ_PATH} is corrupt (parse failed).`);
  }
  throw new Error(`Catalog file missing at ${GZ_PATH} (or legacy ${JSON_PATH})`);
}

export function writeGames(games: unknown, removeLegacy = true): void {
  const tmp = `${GZ_PATH}.tmp`;
  fs.writeFileSync(tmp, gzipSync(JSON.stringify(games), { level: 6 }));
  fs.renameSync(tmp, GZ_PATH);
  if (removeLegacy && fs.existsSync(JSON_PATH)) fs.rmSync(JSON_PATH);
}