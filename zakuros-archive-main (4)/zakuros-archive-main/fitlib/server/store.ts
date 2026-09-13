import fs from "fs";
import path from "path";

// Tiny synchronous JSON-file persistence layer for community data.
// Matches the project's single-file-JSON philosophy: data/<name>.json.
// Stores are small (comments/ratings), so sync I/O is fine.

const DATA_DIR = path.join(process.cwd(), "data");

export function loadStore<T>(name: string, fallback: T): T {
  try {
    const file = path.join(DATA_DIR, `${name}.json`);
    if (!fs.existsSync(file)) {
      return JSON.parse(JSON.stringify(fallback)) as T;
    }
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch (e: any) {
    console.error(`[Store] Failed loading data/${name}.json:`, e.message);
    return JSON.parse(JSON.stringify(fallback)) as T;
  }
}

export function saveStore<T>(name: string, data: T): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, `${name}.json`), JSON.stringify(data, null, 2), "utf-8");
  } catch (e: any) {
    console.error(`[Store] Failed saving data/${name}.json:`, e.message);
  }
}