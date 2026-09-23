# Handoff prompt — bake the era-guarded classic God of War IGDB cover

You are taking over a task from a previous session that got bogged down. Trust the
File tools (Read/Edit/Write/Glob/Grep). Do NOT trust `bash` output as ground truth
— the previous agent's bash channel echoed content it did not author. Verify every
claim with the Read tool.

## Repository
- Repo root (canonical): `C:\Users\Mfree\OneDrive\Documents\zakuro\zakuros-archive-main (4)\zakuros-archive-main`
- Everything lives under `fitlib\` inside it.

## Goal
Give the **classic** `god-of-war` catalog row its `coverImage` from IGDB, ONLY from
the **2005 PS2** entry (era-guarded — reject any other IGDB entry, especially the
2048 PC / 2018 "God of War"). Do NOT touch the modern `god-of-war-3` row (2018 PC,
steamId 1593500, Steam cover — leave it alone). The other 12 classic rows already
have IGDB covers baked at build time via the same era-guarded path; mirror that exact
path (do not improvise a new fetcher).

## Verified facts (README to trust)
- IGDB creds are in `fitlib\.env` lines 5-6 and match the user's real `igdb.env`
  byte-for-byte (verified via Read, side by side):
  - `IGDB_CLIENT_ID=3ojr1re2royz7h84vjs8uuhjmhxo1y`
  - `IGDB_CLIENT_SECRET=durz0385kpv8s9ouu8djcv62k7fllp`
- These are private API secrets. Never print them again, never paste them into bash
  one-liners, never fabricate them. Treat the Read tool as the only authority for
  their bytes.
- The dotnet `.env` is correct and complete — do not re-verify with the shell.

## The actual cause of the silent skip
The running server booted BEFORE the creds existed in `.env`, so its `process.env`
carried no `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET`. `getIGDBAccessToken()` therefore
returned null and `fetchIGDBDetails` returned `{}` → classic GoW never got a cover.

Fix: restart the server fresh so it boots WITH the creds, then run the era-guarded
classic IGDB cover bake.

## Related code (read all of these before writing anything)
- `fitlib\server\metadataService.ts` — `getIGDBAccessToken()` (reads env at call
  time), `fetchIGDBDetails(title)` (IGDB v4 `search "..."; limit 1;`), the IGDB
  stage. This is the IGDB client path.
- `fitlib\server\igdbMatch.ts` — `cleanForSearch`, `normalizeSearchTitle`,
  `igdbBestMatch` (title-only scoring). Strict matching helpers used by the IGDB path.
- `fitlib\server\fillCatalogMetadata.ts` — the era-aware IGDB bake stage(s). Find
  the classic-IGDB guard and replicate exactly. The modern-2018 GoW must be
  rejected by the era guard.
- `fitlib\server\sources.ts` — era-aware merge, `classic` flag semantics, the
  "2005 PS2 classic vs 2018 PC modern" split.
- `fitlib\server\catalogIO.ts` — `readGames`/`writeGames` (atomic persist).
- package.json scripts: `npm run check:catalog`, `npm run typecheck`,
  `npm run fill:gog`, `npm run fix:appids`, and any IGDB/classic bake script
  (grep for it). Prefer the repo's own bake script over a hand-rolled one.

## How to verify (trusted tools only)
1. `check:catalog` green after the bake.
2. `typecheck` green.
3. Read the catalog JSON and show the `god-of-war` row: it must have
   `classic: true`, `coverImage` set to the 2005 PS2 cover, and NO steamId.
4. Read the `god-of-war-3` row: `coverImage` must still be the Steam 2018 cover and
   untouched.
5. Confirm the era guard rejected any 2018-entry match (the classic cover must not be
   the modern GoW key art).

## Rules
- Do not improvise secrets. Do not write creds from memory; if you need them, Read
  the file.
- If ssh/bash output disagrees with the Read tool, trust the Read tool.
- Do not create new files unless required. Prefer the repo's existing bake path.
- Report the byte-verified result (the two rows + guard confirmation) at the end.
